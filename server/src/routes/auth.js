const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
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

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // generous for development; tighten in production
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later' },
});

async function issueTokens(user, res) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken } = signRefreshToken(user);
  user.refreshTokens = (user.refreshTokens || []).filter((t) => t.expiresAt > new Date());
  user.refreshTokens.push({
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
  });
  await user.save();
  setRefreshCookie(res, refreshToken);
  return accessToken;
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

    const accessToken = await issueTokens(user, res);
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
    if (!ok) return res.status(401).json({ message: 'Invalid email or password' });

    const accessToken = await issueTokens(user, res);
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

    // Rotate: remove the used token and issue a fresh pair.
    user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash !== tokenHash);
    const accessToken = await issueTokens(user, res);
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
