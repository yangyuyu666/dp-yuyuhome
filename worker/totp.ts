const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function normalizeBase32Secret(secret: string) {
  const normalized = secret.toUpperCase().replace(/[\s-]+/g, '').replace(/=+$/g, '');

  if (!normalized) {
    throw new Error('密钥不能为空');
  }

  for (const char of normalized) {
    if (!BASE32_ALPHABET.includes(char)) {
      throw new Error('密钥格式无效，请输入 Base32 字符串');
    }
  }

  return normalized;
}

function decodeBase32(secret: string) {
  const normalized = normalizeBase32Secret(secret);
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

function createCounter(counter: number) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, counter, false);
  return bytes;
}

async function hmacSha1(secret: Uint8Array, counter: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, counter);
  return new Uint8Array(signature);
}

function truncate(hmac: Uint8Array, digits: number) {
  const offset = hmac[hmac.length - 1] & 15;
  const code =
    ((hmac[offset] & 127) << 24) |
    ((hmac[offset + 1] & 255) << 16) |
    ((hmac[offset + 2] & 255) << 8) |
    (hmac[offset + 3] & 255);

  return String(code % 10 ** digits).padStart(digits, '0');
}

export async function generateTotp(secret: string) {
  const period = 30;
  const digits = 6;
  const unixTime = Math.floor(Date.now() / 1000);
  const counter = Math.floor(unixTime / period);
  const remaining = period - (unixTime % period);
  const secretBytes = decodeBase32(secret);
  const hmac = await hmacSha1(secretBytes, createCounter(counter));

  return {
    code: truncate(hmac, digits),
    period,
    remaining,
    generatedAt: new Date(unixTime * 1000).toISOString(),
  };
}
