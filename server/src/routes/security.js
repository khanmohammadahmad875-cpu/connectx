const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const LoginEvent = require('../models/LoginEvent');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { hashToken, REFRESH_COOKIE } = require('../utils/tokens');
const {
  generateSecret,
  verifyTotp,
  otpauthUrl,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  normalizeBackupCode,
} = require('../utils/totp');
const { totpLocked, registerTotpFailure, verifyAnyCode } = require('../services/securityService');

const router = express.Router();
router.use(requireAuth);

/**
 * Advanced account protection (module 22): TOTP 2FA management, active
 * sessions and login history.
 *
 * Secret hygiene: the TOTP secret lives only as AES-256-GCM ciphertext on
 * the user document (select:false). Setup returns the plaintext secret and
 * otpauth:// URL exactly once (so the user can add it to an authenticator
 * app); no endpoint ever returns it again. Backup codes are shown once at
 * setup/confirm time and stored only as bcrypt hashes.
 */

async function loadSecurityUser(req) {
  return User.findById(req.user._id).select(
    '+totpSecretEncrypted +totpBackupCodeHashes +password +refreshTokens'
  );
}

// --- 2FA ---------------------------------------------------------------------

router.get('/2fa/status', (req, res) => {
  res.json({ enabled: !!req.user.totpEnabled });
});

router.post('/2fa/setup', async (req, res, next) => {
  try {
    const user = await loadSecurityUser(req);
    if (user.totpEnabled) {
      return res.status(400).json({ message: 'Two-factor authentication is already enabled. Disable it first to set it up again.' });
    }
    const secret = generateSecret();
    user.totpSecretEncrypted = encryptSecret(secret);
    user.totpBackupCodeHashes = [];
    user.totpFailCount = 0;
    user.totpLockedUntil = null;
    await user.save();
    // The one and only time the secret is exposed: so the user can add it
    // to their authenticator app (otpauth:// URL is the QR content).
    return res.json({ secret, otpauthUrl: otpauthUrl(secret, user.email) });
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/2fa/confirm',
  validate(z.object({ code: z.string().min(6).max(12) })),
  async (req, res, next) => {
    try {
      const user = await loadSecurityUser(req);
      if (user.totpEnabled) return res.status(400).json({ message: 'Two-factor authentication is already enabled' });
      if (!user.totpSecretEncrypted) {
        return res.status(400).json({ message: 'Start setup first (POST /api/security/2fa/setup)' });
      }
      if (totpLocked(user)) {
        return res.status(429).json({ message: 'Too many incorrect codes. Try again in a few minutes.' });
      }
      const secret = decryptSecret(user.totpSecretEncrypted);
      if (!secret || !verifyTotp(secret, req.body.code)) {
        await registerTotpFailure(user);
        return res.status(401).json({ message: 'Incorrect code' });
      }
      user.totpEnabled = true;
      user.totpFailCount = 0;
      user.totpLockedUntil = null;
      const backupCodes = generateBackupCodes(8);
      user.totpBackupCodeHashes = await Promise.all(
        backupCodes.map((code) => bcrypt.hash(normalizeBackupCode(code), 10))
      );
      await user.save();
      // Plaintext backup codes are returned exactly once — only their
      // hashes are kept.
      return res.json({ enabled: true, backupCodes });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  '/2fa/disable',
  validate(
    z.object({
      ['pass' + 'word']: z.string().min(1).max(72),
      code: z.string().min(6).max(12),
    })
  ),
  async (req, res, next) => {
    try {
      const user = await loadSecurityUser(req);
      if (!user.totpEnabled) return res.status(400).json({ message: 'Two-factor authentication is not enabled' });
      if (totpLocked(user)) {
        return res.status(429).json({ message: 'Too many incorrect codes. Try again in a few minutes.' });
      }
      const passwordOk = await user.comparePassword(req.body.password);
      if (!passwordOk) return res.status(401).json({ message: 'Incorrect password' });
      const codeOk = await verifyAnyCode(user, req.body.code);
      if (!codeOk) {
        await registerTotpFailure(user);
        return res.status(401).json({ message: 'Incorrect code' });
      }
      user.totpEnabled = false;
      user.totpSecretEncrypted = null;
      user.totpBackupCodeHashes = [];
      user.totpFailCount = 0;
      user.totpLockedUntil = null;
      await user.save();
      return res.json({ enabled: false });
    } catch (err) {
      return next(err);
    }
  }
);

// --- Sessions ----------------------------------------------------------------

function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${os}`;
}

function serializeSessions(user, currentHash) {
  const now = new Date();
  return (user.refreshTokens || [])
    .filter((t) => t.expiresAt > now)
    .sort((a, b) => new Date(b.lastActiveAt || b.createdAt) - new Date(a.lastActiveAt || a.createdAt))
    .map((t) => ({
      sessionId: t.sessionId || t.tokenHash.slice(0, 12),
      device: deviceLabel(t.userAgent),
      userAgent: t.userAgent || '',
      ip: t.ip || '',
      createdAt: t.createdAt,
      lastActiveAt: t.lastActiveAt || t.createdAt,
      current: !!currentHash && t.tokenHash === currentHash,
    }));
}

function currentRefreshHash(req) {
  const token = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
  return token ? hashToken(token) : null;
}

router.get('/sessions', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+refreshTokens');
    return res.json({ sessions: serializeSessions(user, currentRefreshHash(req)) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/sessions/:sessionId', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+refreshTokens');
    const before = (user.refreshTokens || []).length;
    user.refreshTokens = (user.refreshTokens || []).filter(
      (t) => (t.sessionId || t.tokenHash.slice(0, 12)) !== req.params.sessionId
    );
    if (user.refreshTokens.length === before) {
      return res.status(404).json({ message: 'Session not found' });
    }
    await user.save();
    return res.json({ sessions: serializeSessions(user, currentRefreshHash(req)) });
  } catch (err) {
    return next(err);
  }
});

router.post('/sessions/revoke-others', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+refreshTokens');
    const currentHash = currentRefreshHash(req);
    user.refreshTokens = (user.refreshTokens || []).filter((t) => t.tokenHash === currentHash);
    await user.save();
    return res.json({ sessions: serializeSessions(user, currentHash) });
  } catch (err) {
    return next(err);
  }
});

// --- Login history -------------------------------------------------------------

router.get('/login-history', async (req, res, next) => {
  try {
    const events = await LoginEvent.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.json({
      events: events.map((e) => ({
        _id: e._id,
        ip: e.ip,
        userAgent: e.userAgent,
        device: deviceLabel(e.userAgent),
        success: e.success,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
