const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TTL_DAYS = 7;

function accessSecret() {
  return process.env.JWT_ACCESS_SECRET || 'dev-only-change-me-access-secret';
}
function refreshSecret() {
  return process.env.JWT_REFRESH_SECRET || 'dev-only-change-me-refresh-secret';
}

function signAccessToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, accessSecret(), {
    expiresIn: ACCESS_TTL,
  });
}

function signRefreshToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: user._id.toString(), jti }, refreshSecret(), {
    expiresIn: `${REFRESH_TTL_DAYS}d`,
  });
  return { token, jti };
}

function verifyAccessToken(token) {
  return jwt.verify(token, accessSecret());
}
function verifyRefreshToken(token) {
  return jwt.verify(token, refreshSecret());
}

// Short-lived unlock grant for locked chats (Module 19). Issued only after
// the user's PIN verified server-side; scoped so it can never double as an
// access token. 10 minutes keeps an unattended unlocked session short.
const UNLOCK_TTL = '10m';

function signUnlockToken(userId) {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const token = jwt.sign(
    { sub: userId.toString(), scope: 'chat_unlock' },
    accessSecret(),
    { expiresIn: UNLOCK_TTL }
  );
  return { token, expiresAt };
}

function verifyUnlockToken(token, userId) {
  return !!verifyUnlockPayload(token, userId);
}

// Returns the verified payload (with exp) or null.
function verifyUnlockPayload(token, userId) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, accessSecret());
    if (payload.scope !== 'chat_unlock') return null;
    if (userId && payload.sub !== userId.toString()) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const REFRESH_COOKIE = 'connectx_refresh';

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
  });
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  signUnlockToken,
  verifyUnlockToken,
  verifyUnlockPayload,
  hashToken,
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE,
  REFRESH_TTL_DAYS,
};
