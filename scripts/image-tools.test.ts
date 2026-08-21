import assert from 'node:assert/strict';
import {
  attachEncryptedPayload,
  convertedImageName,
  createEncryptedPayload,
  decryptEncryptedPayload,
  encryptedImageName,
  extractEncryptedPayload,
  validatePassphrase,
} from '../src/imageTools';

const ONE_PIXEL_PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
));

async function rejectsWith(run: () => unknown | Promise<unknown>, pattern: RegExp) {
  await assert.rejects(async () => run(), pattern);
}

function findSequence(bytes: Uint8Array, sequence: Uint8Array) {
  outer: for (let index = 0; index <= bytes.length - sequence.length; index++) {
    for (let offset = 0; offset < sequence.length; offset++) {
      if (bytes[index + offset] !== sequence[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

async function main() {
  assert.equal(convertedImageName('旅行.原图.JPEG', 'image/webp'), '旅行.原图.webp');
  assert.equal(encryptedImageName('旅行.原图.JPEG'), '旅行.原图_encrypted.png');
  assert.throws(() => validatePassphrase('short'), /至少需要 8 个字符/);
  assert.throws(() => validatePassphrase('        '), /不能全部为空白/);

  const originalBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
  const original = new File([originalBytes], '旅行.原图.JPEG', {
    type: 'image/jpeg',
    lastModified: 1_725_000_000_000,
  });
  const passphrase = '正确 密钥 123';
  const payload = await createEncryptedPayload(original, passphrase);
  const encryptedPng = attachEncryptedPayload(ONE_PIXEL_PNG, payload);
  const extracted = extractEncryptedPayload(encryptedPng);

  assert.ok(extracted, 'encrypted PNG should contain the private payload chunk');
  assert.deepEqual(extracted, payload);

  const decrypted = await decryptEncryptedPayload(extracted, passphrase);
  assert.deepEqual(decrypted.bytes, originalBytes);
  assert.deepEqual(decrypted.metadata, {
    name: '旅行.原图.JPEG',
    type: 'image/jpeg',
    lastModified: 1_725_000_000_000,
  });

  await rejectsWith(
    () => decryptEncryptedPayload(extracted, '错误 密钥 123'),
    /密钥错误，或加密图片已经损坏/,
  );

  const tamperedPayload = extracted.slice();
  tamperedPayload[tamperedPayload.length - 1] ^= 0x01;
  await rejectsWith(
    () => decryptEncryptedPayload(tamperedPayload, passphrase),
    /密钥错误，或加密图片已经损坏/,
  );

  const unknownVersion = extracted.slice();
  unknownVersion[4] = 99;
  await rejectsWith(
    () => decryptEncryptedPayload(unknownVersion, passphrase),
    /暂不支持此加密图片版本/,
  );

  const damagedPng = encryptedPng.slice();
  const chunkTypeOffset = findSequence(damagedPng, new TextEncoder().encode('dyIm'));
  assert.ok(chunkTypeOffset > 0, 'test fixture should contain the private chunk');
  damagedPng[chunkTypeOffset + 4 + 10] ^= 0x01;
  assert.throws(() => extractEncryptedPayload(damagedPng), /PNG 数据块 dyIm 已损坏/);

  assert.equal(extractEncryptedPayload(ONE_PIXEL_PNG), null);
  assert.throws(
    () => attachEncryptedPayload(encryptedPng, payload),
    /已经包含本站加密数据/,
  );

  console.log('image tools tests passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
