// Chat-lock security helpers (Modules 19 + 21).
//
// The lock PIN (4–6 digits) and the hidden-chat secret code live on the User
// document as bcrypt hashes only. Verification is rate-limited: after
// MAX_ATTEMPTS consecutive failures the credential is locked out for
// LOCKOUT_MS. Access to a locked conversation requires a short-lived unlock
// grant (see utils/tokens signUnlockToken) — enforced in the routes and in
// messageService, never only in the client.
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ConversationMember = require('../models/ConversationMember');
const { verifyUnlockToken } = require('../utils/tokens');

const PIN_PATTERN = /^\d{4,6}$/;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getSecurityUser(userId) {
  return User.findById(userId).select(
    '+password +chatLockPinHash +secretCodeHash'
  );
}

// Throws 429 while the credential is in its lockout window.
function assertNotLockedOut(user, kind) {
  const until = kind === 'pin' ? user.pinLockedUntil : user.secretLockedUntil;
  if (until && until.getTime() > Date.now()) {
    throw httpError(
      429,
      'Too many failed attempts. Please wait a few minutes and try again.'
    );
  }
}

// Records a failed attempt; the MAX_ATTEMPTS-th failure starts the lockout.
async function recordFailure(user, kind) {
  if (kind === 'pin') {
    user.pinFailCount = (user.pinFailCount || 0) + 1;
    if (user.pinFailCount >= MAX_ATTEMPTS) {
      user.pinLockedUntil = new Date(Date.now() + LOCKOUT_MS);
      user.pinFailCount = 0;
    }
  } else {
    user.secretFailCount = (user.secretFailCount || 0) + 1;
    if (user.secretFailCount >= MAX_ATTEMPTS) {
      user.secretLockedUntil = new Date(Date.now() + LOCKOUT_MS);
      user.secretFailCount = 0;
    }
  }
  await user.save();
}

async function recordSuccess(user, kind) {
  if (kind === 'pin') {
    user.pinFailCount = 0;
    user.pinLockedUntil = null;
  } else {
    user.secretFailCount = 0;
    user.secretLockedUntil = null;
  }
  await user.save();
}

// Verifies the user's PIN. Throws 400 (not set), 401 (wrong), 429 (lockout).
async function verifyPin(userId, pin) {
  const user = await getSecurityUser(userId);
  if (!user.chatLockPinHash) {
    throw httpError(400, 'No chat lock PIN is set');
  }
  assertNotLockedOut(user, 'pin');
  const ok = await bcrypt.compare(String(pin || ''), user.chatLockPinHash);
  if (!ok) {
    await recordFailure(user, 'pin');
    throw httpError(401, 'Incorrect PIN');
  }
  await recordSuccess(user, 'pin');
  return user;
}

// Verifies the user's hidden-chat secret code. Same failure semantics.
async function verifySecret(userId, secretCode) {
  const user = await getSecurityUser(userId);
  if (!user.secretCodeHash) {
    throw httpError(400, 'No secret code is set');
  }
  assertNotLockedOut(user, 'secret');
  const ok = await bcrypt.compare(String(secretCode || ''), user.secretCodeHash);
  if (!ok) {
    await recordFailure(user, 'secret');
    throw httpError(401, 'Incorrect secret code');
  }
  await recordSuccess(user, 'secret');
  return user;
}

// Does this request carry a valid unlock grant for this user?
function requestUnlocked(req, userId) {
  const token = req.headers && req.headers['x-unlock-token'];
  return verifyUnlockToken(token, userId || (req.user && req.user._id));
}

// Throws 423 when the conversation is locked for the user and the caller has
// no valid unlock grant. Used by every route that reads or writes messages.
async function assertConversationUnlocked(conversationId, userId, unlocked) {
  const member = await ConversationMember.findOne({ conversationId, userId });
  if (member && member.locked && !unlocked) {
    throw httpError(423, 'This chat is locked. Unlock it to continue.');
  }
  return member;
}

// Conversation ids locked (for this user) — used to keep locked content out
// of notification payloads and other aggregate responses.
async function lockedConversationIds(userId) {
  const rows = await ConversationMember.find({ userId, locked: true })
    .select('conversationId')
    .lean();
  return rows.map((r) => r.conversationId);
}

module.exports = {
  PIN_PATTERN,
  MAX_ATTEMPTS,
  LOCKOUT_MS,
  httpError,
  getSecurityUser,
  verifyPin,
  verifySecret,
  requestUnlocked,
  assertConversationUnlocked,
  lockedConversationIds,
};
