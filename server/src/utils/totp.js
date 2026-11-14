const crypto = require('crypto');

/**
 * TOTP two-factor authentication (module 22) — RFC 6238 implemented directly
 * on node:crypto (HMAC-SHA1), plus RFC 4226 HOTP and RFC 4648 base32.
 * No new dependency: the algorithm is small and standard.
 *
 * The shared secret is never stored in plain text and never leaves the
 * server after setup: at rest it is AES-256-GCM encrypted with a key
 * derived from TOTP_ENCRYPTION_KEY (falling back to the JWT access secret).
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += '=';
  return out;
}

function base32Decode(input) {
  const clean = String(input || '')
    .toUpperCase()
    .replace(/=+$/, '')
    .replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit secret, 32 base32 chars
}

function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function totp(secretBase32, date = new Date(), stepSeconds = 30) {
  return hotp(secretBase32, Math.floor(date.getTime() / 1000 / stepSeconds));
}

// Accepts the current code plus one step either side (clock drift).
function verifyTotp(secretBase32, code, date = new Date()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(date.getTime() / 1000 / 30);
  for (const drift of [-1, 0, 1]) {
    const expected = hotp(secretBase32, counter + drift);
    if (
      expected.length === clean.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))
    ) {
      return true;
    }
  }
  return false;
}

function otpauthUrl(secretBase32, accountLabel, issuer = 'ConnectX') {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return (
    `otpauth://totp/${label}?secret=${secretBase32}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
  );
}

// --- Secret encryption at rest (AES-256-GCM) ---------------------------------

function encryptionKey() {
  const material =
    process.env.TOTP_ENCRYPTION_KEY ||
    process.env.JWT_ACCESS_SECRET ||
    'dev-only-change-me-access-secret';
  return crypto.createHash('sha256').update(String(material)).digest();
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString('base64')).join('.');
}

function decryptSecret(stored) {
  if (!stored) return null;
  const [iv, tag, ciphertext] = String(stored)
    .split('.')
    .map((part) => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// Backup codes: 8 codes, "XXXX-XXXX" from an unambiguous alphabet.
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const pick = () =>
      BACKUP_ALPHABET[crypto.randomInt(0, BACKUP_ALPHABET.length)];
    const raw = Array.from({ length: 8 }, pick).join('');
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

function normalizeBackupCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  base32Encode,
  base32Decode,
  generateSecret,
  hotp,
  totp,
  verifyTotp,
  otpauthUrl,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  normalizeBackupCode,
};
