const bcrypt = require('bcryptjs');
const { verifyTotp, decryptSecret, normalizeBackupCode } = require('../utils/totp');

/**
 * Shared 2FA verification helpers (module 22), used by both the security
 * settings routes and the login second step.
 *
 * Wrong-code attempts are rate-limited on the user document with the same
 * counter + lockout pattern as the chat-lock PIN: MAX_TOTP_ATTEMPTS
 * failures lock code verification for TOTP_LOCKOUT_MS (callers answer 429).
 */

const MAX_TOTP_ATTEMPTS = 5;
const TOTP_LOCKOUT_MS = 5 * 60 * 1000;

function totpLocked(user) {
  return !!(user.totpLockedUntil && user.totpLockedUntil > new Date());
}

async function registerTotpFailure(user) {
  user.totpFailCount = (user.totpFailCount || 0) + 1;
  if (user.totpFailCount >= MAX_TOTP_ATTEMPTS) {
    user.totpLockedUntil = new Date(Date.now() + TOTP_LOCKOUT_MS);
    user.totpFailCount = 0;
  }
  await user.save();
}

// Verifies a code against the user's TOTP secret OR their one-time backup
// codes (a matching backup code is consumed). Returns true/false; callers
// handle failure counting. Never throws on a wrong code. The user document
// must have +totpSecretEncrypted +totpBackupCodeHashes selected.
async function verifyAnyCode(user, code) {
  if (!user.totpSecretEncrypted) return false;
  const secret = decryptSecret(user.totpSecretEncrypted);
  if (secret && verifyTotp(secret, code)) return true;
  const normalized = normalizeBackupCode(code);
  if (normalized.length >= 8) {
    const hashes = [...(user.totpBackupCodeHashes || [])];
    for (let i = 0; i < hashes.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(normalized, hashes[i])) {
        hashes.splice(i, 1); // one-time use
        user.totpBackupCodeHashes = hashes;
        user.markModified('totpBackupCodeHashes');
        await user.save();
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  MAX_TOTP_ATTEMPTS,
  TOTP_LOCKOUT_MS,
  totpLocked,
  registerTotpFailure,
  verifyAnyCode,
};
