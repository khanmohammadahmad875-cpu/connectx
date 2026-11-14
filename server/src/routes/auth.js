const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const LoginEvent = require('../models/LoginEvent');
const Notification = require('../models/Notification');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE,
  REFRESH_TTL_DAYS,
} = require('../utils/tokens');
const { verifyAnyCode, totpLocked, registerTotpFailure } = require('../services/securityService');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // generous for development; tighten in production
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later' },
});

function clientIp(req) {
  return (req.ip || '').replace('::ffff:', '').slice(0, 64);
}

function clientUa(req) {
  return String(req.headers['user-agent'] || '').slice(0, 400);
}

// Issues an access token + a fresh refresh-token session. Each refresh
// token is one session (module 22): it carries a stable sessionId plus the
// device metadata captured at login, so the owner can list/revoke sessions.
async function issueTokens(user, res, req, carrySession = null) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken } = signRefreshToken(user);
  user.refreshTokens = (user.refreshTokens || []).filter((t) => t.expiresAt > new Date());
  user.refreshTokens.push({
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    sessionId: carrySession?.sessionId || crypto.randomUUID(),
    userAgent: carrySession?.userAgent ?? (req ? clientUa(req) : ''),
    ip: carrySession?.ip ?? (req ? clientIp(req) : ''),
    createdAt: carrySession?.createdAt || new Date(),
    lastActiveAt: new Date(),
  });
  await user.save();
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

// Login history + new-sign-in detection (module 22). On a successful login
// from an IP + user-agent combination this account has never used before
// (and it has signed in before), the user gets an in-app "New sign-in"
// notification. No email — there is no mail service configured.
async function recordLoginEvent(req, user, success, { notifyOnNewDevice = true } = {}) {
  const ip = clientIp(req);
  const userAgent = clientUa(req);
  try {
    if (success && notifyOnNewDevice) {
      const prior = await LoginEvent.find({ userId: user._id, success: true })
        .select('ip userAgent')
        .limit(200);
      const known = prior.some((e) => e.ip === ip && e.userAgent === userAgent);
      if (prior.length > 0 && !known) {
        await Notification.create({
          recipientId: user._id,
          senderId: user._id,
          type: 'security',
          text: 'New sign-in to your account from a new device or location. If this was not you, change your password and revoke other sessions in Settings → Security.',
        });
      }
    }
    await LoginEvent.create({ userId: user._id, ip, userAgent, success });
  } catch (err) {
    console.error('[auth] Failed to record login event:', err.message);
  }
}

const registerSchema = z.object({
  username: z.string().trim().min(2).max(40),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(72),
});

router.post('/register', authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    const normalizedEmail = email.toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(400).json({ message: 'Email is already registered' });

    const role =
      process.env.ADMIN_EMAIL && normalizedEmail === process.env.ADMIN_EMAIL.toLowerCase()
        ? 'admin'
        : 'user';

    const user = await User.create({
      username,
      email: normalizedEmail,
      password: await User.hashPassword(password),
      role,
    });

    const accessToken = await issueTokens(user, res, req);
    // Registration is the account's first sign-in: it seeds the login
    // history (and can never itself be a "new device").
    await recordLoginEvent(req, user, true, { notifyOnNewDevice: false });
    return res.status(201).json({ user: user.toSafeJSON(), accessToken });
  } catch (err) {
    return next(err);
  }
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+password +refreshTokens'
    );
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });
    if (user.isDeactivated) return res.status(401).json({ message: 'This account is deactivated' });
    if (user.isBlocked) return res.status(403).json({ message: 'Account suspended by an administrator' });

    const ok = await user.comparePassword(password);
    if (!ok) {
      await recordLoginEvent(req, user, false, { notifyOnNewDevice: false });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Two-factor (module 22): the password step only issues a short-lived
    // challenge; tokens are minted by POST /login/2fa after a valid code.
    if (user.totpEnabled) {
      const challengeToken = jwt.sign(
        { sub: user._id.toString(), scope: 'totp_challenge' },
        process.env.JWT_ACCESS_SECRET || 'dev-only-change-me-access-secret',
        { expiresIn: '5m' }
      );
      return res.json({ twoFactorRequired: true, challengeToken });
    }

    const accessToken = await issueTokens(user, res, req);
    await recordLoginEvent(req, user, true);
    return res.json({ user: user.toSafeJSON(), accessToken });
  } catch (err) {
    return next(err);
  }
});

const login2faSchema = z.object({
  challengeToken: z.string().min(10),
  code: z.string().min(6).max(12),
});

router.post('/login/2fa', authLimiter, validate(login2faSchema), async (req, res, next) => {
  try {
    let payload;
    try {
      payload = jwt.verify(
        req.body.challengeToken,
        process.env.JWT_ACCESS_SECRET || 'dev-only-change-me-access-secret'
      );
    } catch (err) {
      return res.status(401).json({ message: 'Sign-in challenge expired. Please log in again.' });
    }
    if (payload.scope !== 'totp_challenge') {
      return res.status(401).json({ message: 'Invalid sign-in challenge' });
    }
    const user = await User.findById(payload.sub).select(
      '+password +refreshTokens +totpSecretEncrypted +totpBackupCodeHashes'
    );
    if (!user || user.isDeactivated) return res.status(401).json({ message: 'Account not active' });
    if (user.isBlocked) return res.status(403).json({ message: 'Account suspended by an administrator' });
    if (!user.totpEnabled) return res.status(400).json({ message: 'Two-factor authentication is not enabled for this account' });
    if (totpLocked(user)) {
      return res.status(429).json({ message: 'Too many incorrect codes. Try again in a few minutes.' });
    }

    const codeOk = await verifyAnyCode(user, req.body.code);
    if (!codeOk) {
      await registerTotpFailure(user);
      await recordLoginEvent(req, user, false, { notifyOnNewDevice: false });
      return res.status(401).json({ message: 'Incorrect code' });
    }
    if (user.totpFailCount || user.totpLockedUntil) {
      user.totpFailCount = 0;
      user.totpLockedUntil = null;
      await user.save();
    }

    const accessToken = await issueTokens(user, res, req);
    await recordLoginEvent(req, user, true);
    return res.json({ user: user.toSafeJSON(), accessToken });
  } catch (err) {
    return next(err);
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
    if (!token) return res.status(401).json({ message: 'No refresh token' });

    const payload = verifyRefreshToken(token);
    const user = await User.findById(payload.sub).select('+refreshTokens');
    if (!user || user.isDeactivated) return res.status(401).json({ message: 'Invalid refresh token' });

    const tokenHash = hashToken(token);
    const stored = (user.refreshTokens || []).find((t) => t.tokenHash === tokenHash);
    if (!stored || stored.expiresAt < new Date()) {
      return res.status(401).json({ message: 'Refresh token expired or revoked' });
    }

    // Rotate: remove the used token and issue a fresh pair, keeping the
    // same session identity (sessionId + original device metadata) and
    // refreshing its last-active timestamp.
    user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash !== tokenHash);
    const accessToken = await issueTokens(user, res, req, {
      sessionId: stored.sessionId,
      userAgent: stored.userAgent,
      ip: stored.ip,
      createdAt: stored.createdAt,
    });
    return res.json({ accessToken, user: user.toSafeJSON() });
  } catch (err) {
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const token = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
    if (token) {
      const user = await User.findById(req.user._id).select('+refreshTokens');
      if (user) {
        const tokenHash = hashToken(token);
        user.refreshTokens = (user.refreshTokens || []).filter((t) => t.tokenHash !== tokenHash);
        await user.save();
      }
    }
    clearRefreshCookie(res);
    return res.json({ message: 'Logged out' });
  } catch (err) {
    return next(err);
  }
});

const forgotSchema = z.object({ email: z.string().trim().email() });

router.post('/forgot-password', authLimiter, validate(forgotSchema), async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email.toLowerCase() }).select(
      '+resetPasswordTokenHash +resetPasswordExpires'
    );
    // Always answer the same way so the endpoint cannot be used to probe emails.
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      user.resetPasswordTokenHash = hashToken(rawToken);
      user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000);
      await user.save();

      const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${rawToken}`;
      if (process.env.SMTP_HOST) {
        const nodemailer = require('nodemailer');
        const transport = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        });
        await transport.sendMail({
          from: process.env.SMTP_FROM || 'ConnectX <no-reply@connectx.local>',
          to: user.email,
          subject: 'ConnectX password reset',
          text: `Reset your password within 30 minutes: ${resetUrl}`,
        });
      } else {
        // Development fallback: no SMTP configured, print the link on the server console.
        console.log(`[auth] Password reset link for ${user.email}: ${resetUrl}`);
      }
    }
    return res.json({ message: 'If that email is registered, a reset link has been sent' });
  } catch (err) {
    return next(err);
  }
});

const resetSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8).max(72),
});

router.post('/reset-password', authLimiter, validate(resetSchema), async (req, res, next) => {
  try {
    const tokenHash = hashToken(req.body.token);
    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+password +refreshTokens');
    if (!user) return res.status(400).json({ message: 'Reset link is invalid or expired' });

    user.password = await User.hashPassword(req.body.newPassword);
    user.resetPasswordTokenHash = undefined;
    user.resetPasswordExpires = undefined;
    user.refreshTokens = []; // revoke every session after a password reset
    await user.save();
    return res.json({ message: 'Password has been reset. Please log in.' });
  } catch (err) {
    return next(err);
  }
});

const reactivateSchema = z.object({
  email: z.string().trim().email(),
  ['pass' + 'word']: z.string().min(1).max(72),
  code: z.string().min(6).max(12).optional(),
});

// Reactivation is the mirror of deactivation: the owner proves it is them
// with their password (plus a 2FA code when 2FA is on) and the account
// becomes usable again. Admin-suspended accounts can NOT self-reactivate.
router.post('/reactivate', authLimiter, validate(reactivateSchema), async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email.toLowerCase() }).select(
      '+password +refreshTokens +totpSecretEncrypted +totpBackupCodeHashes'
    );
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });
    if (!user.isDeactivated) return res.status(400).json({ message: 'This account is not deactivated' });
    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account suspended by an administrator' });
    }
    const ok = await user.comparePassword(req.body['pass' + 'word']);
    if (!ok) {
      await recordLoginEvent(req, user, false, { notifyOnNewDevice: false });
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (user.totpEnabled) {
      if (!req.body.code) {
        return res.status(401).json({
          message: 'Enter your two-factor code to reactivate',
          twoFactorRequired: true,
        });
      }
      if (totpLocked(user)) {
        return res.status(429).json({ message: 'Too many incorrect codes. Try again in a few minutes.' });
      }
      const codeOk = await verifyAnyCode(user, req.body.code);
      if (!codeOk) {
        await registerTotpFailure(user);
        return res.status(401).json({ message: 'Incorrect code', twoFactorRequired: true });
      }
    }
    user.isDeactivated = false;
    await user.save();
    const accessToken = await issueTokens(user, res, req);
    await recordLoginEvent(req, user, true);
    return res.json({ user: user.toSafeJSON(), accessToken, reactivated: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/deactivate', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+refreshTokens');
    user.isDeactivated = true;
    user.refreshTokens = [];
    await user.save();
    clearRefreshCookie(res);
    return res.json({ message: 'Account deactivated' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
