export type ConvertibleImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export const MAX_SOURCE_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_ENCRYPTED_PNG_BYTES = 128 * 1024 * 1024;
export const PBKDF2_ITERATIONS = 600_000;

const MIN_PBKDF2_ITERATIONS = 100_000;
const MAX_PBKDF2_ITERATIONS = 2_000_000;
const MAX_METADATA_BYTES = 64 * 1024;
const NOISE_IMAGE_SIZE = 256;
const CUSTOM_CHUNK_TYPE = 'dyIm';
const FORMAT_MAGIC = new Uint8Array([0x44, 0x59, 0x49, 0x31]); // DYI1
const FORMAT_VERSION = 1;
const KDF_PBKDF2_SHA256 = 1;
const CIPHER_AES_256_GCM = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const IMAGE_EXTENSIONS: Record<ConvertibleImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXTENSION_MIME_TYPES: Record<string, ConvertibleImageMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

type EncryptedMetadata = {
  name: string;
  type: string;
  lastModified: number;
};

type PngChunk = {
  type: string;
  start: number;
  dataStart: number;
  dataEnd: number;
  end: number;
};

export type DecryptedImage = {
  bytes: Uint8Array;
  metadata: EncryptedMetadata;
};

function assertCryptoAvailable() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前浏览器不支持 Web Crypto，无法进行图片加解密');
  }
}

function concatBytes(...parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

function uint32Bytes(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function readUint32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    throw new Error('文件结构不完整');
  }

  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function randomBytes(length: number) {
  assertCryptoAvailable();
  const result = new Uint8Array(length);

  for (let offset = 0; offset < result.byteLength; offset += 65_536) {
    crypto.getRandomValues(result.subarray(offset, Math.min(offset + 65_536, result.byteLength)));
  }

  return result;
}

function safeLeafFileName(name: string) {
  const safe = name
    .replaceAll(/[\\/]/g, '_')
    .replaceAll(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return safe || 'decrypted-image';
}

function baseFileName(name: string) {
  const safe = safeLeafFileName(name);
  const dot = safe.lastIndexOf('.');
  return dot > 0 ? safe.slice(0, dot) : safe;
}

export function imageMimeFromFile(file: File): ConvertibleImageMime | null {
  if (file.type in IMAGE_EXTENSIONS) {
    return file.type as ConvertibleImageMime;
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME_TYPES[extension] ?? null;
}

export function imageExtension(mime: ConvertibleImageMime) {
  return IMAGE_EXTENSIONS[mime];
}

export function convertedImageName(name: string, mime: ConvertibleImageMime) {
  return `${baseFileName(name)}.${imageExtension(mime)}`;
}

export function encryptedImageName(name: string) {
  return `${baseFileName(name)}_encrypted.png`;
}

export function validatePassphrase(passphrase: string) {
  if (Array.from(passphrase).length === 0) {
    throw new Error('密钥不能为空');
  }
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    const cleanup = () => URL.revokeObjectURL(url);
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('浏览器无法读取这张图片，请确认文件没有损坏'));
    };
    image.src = url;
  });
}

export async function convertImage(file: File, targetMime: ConvertibleImageMime) {
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('原图不能超过 100 MiB');
  }

  const sourceMime = imageMimeFromFile(file);
  if (!sourceMime) {
    throw new Error('仅支持 JPEG、PNG 和 WebP 图片');
  }

  if (sourceMime === targetMime) {
    throw new Error('请选择与原图不同的目标格式');
  }

  const image = await loadImage(file);
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('无法获取图片尺寸');
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('浏览器无法创建图片处理画布');
  }

  if (targetMime === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('图片编码失败，请换一张图片后重试')),
      targetMime,
      targetMime === 'image/png' ? undefined : 0.92,
    );
  });

  return new File([blob], convertedImageName(file.name, targetMime), {
    type: targetMime,
    lastModified: Date.now(),
  });
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number) {
  assertCryptoAvailable();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function buildEncryptionHeader(salt: Uint8Array, iv: Uint8Array, iterations: number) {
  return concatBytes(
    FORMAT_MAGIC,
    new Uint8Array([
      FORMAT_VERSION,
      KDF_PBKDF2_SHA256,
      CIPHER_AES_256_GCM,
      0,
    ]),
    uint32Bytes(iterations),
    new Uint8Array([salt.byteLength, iv.byteLength]),
    salt,
    iv,
  );
}

export async function createEncryptedPayload(file: File, passphrase: string) {
  validatePassphrase(passphrase);

  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('原图不能超过 100 MiB');
  }

  if (!imageMimeFromFile(file)) {
    throw new Error('仅支持加密 JPEG、PNG 和 WebP 图片');
  }

  const originalBytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
    try {
      if (extractEncryptedPayload(originalBytes)) {
        throw new Error('这张图片已经包含本站加密数据，请直接使用解密功能');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('已经包含')) {
        throw error;
      }
      // A regular PNG can be encrypted even if unrelated ancillary chunks are unusual.
    }
  }

  const metadataBytes = encoder.encode(JSON.stringify({
    name: safeLeafFileName(file.name),
    type: file.type || imageMimeFromFile(file) || 'application/octet-stream',
    lastModified: Number.isFinite(file.lastModified) ? file.lastModified : Date.now(),
  } satisfies EncryptedMetadata));

  if (metadataBytes.byteLength > MAX_METADATA_BYTES) {
    throw new Error('文件名或元数据过长');
  }

  const plaintext = concatBytes(uint32Bytes(metadataBytes.byteLength), metadataBytes, originalBytes);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = buildEncryptionHeader(salt, iv, PBKDF2_ITERATIONS);
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: header, tagLength: AES_GCM_TAG_BITS },
    key,
    plaintext,
  );

  return concatBytes(header, new Uint8Array(encrypted));
}

function parseEncryptionHeader(payload: Uint8Array) {
  const fixedLength = FORMAT_MAGIC.byteLength + 4 + 4 + 2;
  if (payload.byteLength < fixedLength + SALT_BYTES + IV_BYTES + 16) {
    throw new Error('加密数据不完整');
  }

  if (!equalBytes(payload.subarray(0, FORMAT_MAGIC.byteLength), FORMAT_MAGIC)) {
    throw new Error('不是本站生成的加密图片');
  }

  let offset = FORMAT_MAGIC.byteLength;
  const version = payload[offset++];
  const kdf = payload[offset++];
  const cipher = payload[offset++];
  offset += 1;
  const iterations = readUint32(payload, offset);
  offset += 4;
  const saltLength = payload[offset++];
  const ivLength = payload[offset++];

  if (version !== FORMAT_VERSION) {
    throw new Error(`暂不支持此加密图片版本（v${version}）`);
  }

  if (kdf !== KDF_PBKDF2_SHA256 || cipher !== CIPHER_AES_256_GCM) {
    throw new Error('暂不支持此加密算法');
  }

  if (
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS ||
    saltLength !== SALT_BYTES ||
    ivLength !== IV_BYTES
  ) {
    throw new Error('加密参数无效');
  }

  const headerLength = fixedLength + saltLength + ivLength;
  if (payload.byteLength < headerLength + 16) {
    throw new Error('加密数据不完整');
  }

  const salt = payload.subarray(offset, offset + saltLength);
  offset += saltLength;
  const iv = payload.subarray(offset, offset + ivLength);

  return {
    header: payload.subarray(0, headerLength),
    ciphertext: payload.subarray(headerLength),
    iterations,
    salt,
    iv,
  };
}

export async function decryptEncryptedPayload(payload: Uint8Array, passphrase: string): Promise<DecryptedImage> {
  validatePassphrase(passphrase);
  const { header, ciphertext, iterations, salt, iv } = parseEncryptionHeader(payload);
  const key = await deriveAesKey(passphrase, salt, iterations);
  let plaintextBuffer: ArrayBuffer;

  try {
    plaintextBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: header, tagLength: AES_GCM_TAG_BITS },
      key,
      ciphertext,
    );
  } catch {
    throw new Error('密钥错误，或加密图片已经损坏');
  }

  const plaintext = new Uint8Array(plaintextBuffer);
  const metadataLength = readUint32(plaintext, 0);
  if (metadataLength > MAX_METADATA_BYTES || 4 + metadataLength > plaintext.byteLength) {
    throw new Error('解密后的文件信息无效');
  }

  let metadata: EncryptedMetadata;
  try {
    metadata = JSON.parse(decoder.decode(plaintext.subarray(4, 4 + metadataLength))) as EncryptedMetadata;
  } catch {
    throw new Error('解密后的文件信息无效');
  }

  if (
    !metadata ||
    typeof metadata.name !== 'string' ||
    typeof metadata.type !== 'string' ||
    typeof metadata.lastModified !== 'number'
  ) {
    throw new Error('解密后的文件信息无效');
  }

  const bytes = plaintext.slice(4 + metadataLength);
  if (bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('解密后的图片超过 100 MiB 限制');
  }

  return {
    bytes,
    metadata: {
      name: safeLeafFileName(metadata.name),
      type: metadata.type || 'application/octet-stream',
      lastModified: Number.isFinite(metadata.lastModified) ? metadata.lastModified : Date.now(),
    },
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let k = 0; k < 8; k++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(bytes: Uint8Array) {
  if (bytes.byteLength < PNG_SIGNATURE.byteLength || !equalBytes(bytes.subarray(0, 8), PNG_SIGNATURE)) {
    throw new Error('请选择有效的 PNG 图片');
  }

  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.byteLength;
  let foundEnd = false;

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) {
      throw new Error('PNG 文件结构不完整');
    }

    const length = readUint32(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + 4;
    if (dataEnd < dataStart || end > bytes.byteLength) {
      throw new Error('PNG 数据块长度无效');
    }

    let type: string;
    try {
      type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    } catch {
      throw new Error('PNG 数据块类型无效');
    }

    const expectedCrc = readUint32(bytes, dataEnd);
    const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
    if (expectedCrc !== actualCrc) {
      throw new Error(`PNG 数据块 ${type} 已损坏`);
    }

    chunks.push({ type, start: offset, dataStart, dataEnd, end });
    offset = end;

    if (type === 'IEND') {
      foundEnd = true;
      break;
    }
  }

  if (!foundEnd) {
    throw new Error('PNG 文件缺少结束标记');
  }

  return chunks;
}

function makePngChunk(type: string, data: Uint8Array) {
  const typeBytes = encoder.encode(type);
  if (typeBytes.byteLength !== 4) {
    throw new Error('PNG 数据块名称无效');
  }

  const crc = uint32Bytes(crc32(concatBytes(typeBytes, data)));
  return concatBytes(uint32Bytes(data.byteLength), typeBytes, data, crc);
}

export function attachEncryptedPayload(pngBytes: Uint8Array, payload: Uint8Array) {
  const chunks = parsePng(pngBytes);
  if (chunks.some((chunk) => chunk.type === CUSTOM_CHUNK_TYPE)) {
    throw new Error('这张图片已经包含本站加密数据');
  }

  const endChunk = chunks.find((chunk) => chunk.type === 'IEND');
  if (!endChunk) {
    throw new Error('PNG 文件缺少结束标记');
  }

  return concatBytes(
    pngBytes.subarray(0, endChunk.start),
    makePngChunk(CUSTOM_CHUNK_TYPE, payload),
    pngBytes.subarray(endChunk.start),
  );
}

export function extractEncryptedPayload(pngBytes: Uint8Array) {
  const chunks = parsePng(pngBytes);
  const encryptedChunks = chunks.filter((chunk) => chunk.type === CUSTOM_CHUNK_TYPE);

  if (encryptedChunks.length === 0) {
    return null;
  }

  if (encryptedChunks.length > 1) {
    throw new Error('PNG 中包含重复的加密数据块');
  }

  const chunk = encryptedChunks[0];
  return pngBytes.slice(chunk.dataStart, chunk.dataEnd);
}

async function createNoisePng() {
  const canvas = document.createElement('canvas');
  canvas.width = NOISE_IMAGE_SIZE;
  canvas.height = NOISE_IMAGE_SIZE;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('浏览器无法创建加密图片画布');
  }

  const imageData = context.createImageData(NOISE_IMAGE_SIZE, NOISE_IMAGE_SIZE);
  const rgb = randomBytes(NOISE_IMAGE_SIZE * NOISE_IMAGE_SIZE * 3);
  let rgbIndex = 0;

  for (let pixel = 0; pixel < NOISE_IMAGE_SIZE * NOISE_IMAGE_SIZE; pixel++) {
    const dataIndex = pixel * 4;
    imageData.data[dataIndex] = rgb[rgbIndex++];
    imageData.data[dataIndex + 1] = rgb[rgbIndex++];
    imageData.data[dataIndex + 2] = rgb[rgbIndex++];
    imageData.data[dataIndex + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('无法生成噪点 PNG')),
      'image/png',
    );
  });

  return new Uint8Array(await blob.arrayBuffer());
}

export async function encryptImageToNoisePng(file: File, passphrase: string) {
  const payload = await createEncryptedPayload(file, passphrase);
  const noisePng = await createNoisePng();
  const output = attachEncryptedPayload(noisePng, payload);

  if (output.byteLength > MAX_ENCRYPTED_PNG_BYTES) {
    throw new Error('加密后的 PNG 超过 128 MiB 限制');
  }

  return new File([output], encryptedImageName(file.name), {
    type: 'image/png',
    lastModified: Date.now(),
  });
}

export async function decryptNoisePng(file: File, passphrase: string) {
  if (file.size > MAX_ENCRYPTED_PNG_BYTES) {
    throw new Error('加密 PNG 不能超过 128 MiB');
  }

  const pngBytes = new Uint8Array(await file.arrayBuffer());
  const payload = extractEncryptedPayload(pngBytes);
  if (!payload) {
    throw new Error('这不是本站生成的加密图片，未找到加密数据');
  }

  const { bytes, metadata } = await decryptEncryptedPayload(payload, passphrase);
  return new File([bytes], metadata.name, {
    type: metadata.type,
    lastModified: metadata.lastModified,
  });
}
