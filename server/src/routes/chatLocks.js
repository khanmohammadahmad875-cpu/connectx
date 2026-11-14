const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireMembership } = require('../services/messageService');
const {
  PIN_PATTERN,
  httpError,
  getSecurityUser,
  verifyPin,
  verifySecret,
  requestUnlocked,
} = require('../services/lockService');
const { signUnlockToken } = require('../utils/tokens');
const { serializeConversation, populateConv } = require('./conversations');

const router = express.Router();
router.use(requireAuth);

// Status never includes content: just whether a PIN/secret exists and how
// many chats are locked/hidden for this user.
router.get('/status', async (req, res, next) => {
  try {
    const user = await getSecurityUser(req.user._id);
    const [lockedCount, hiddenCount] = await Promise.all([
      ConversationMember.countDocuments({ userId: req.user._id, locked: true, hidden: false }),
      ConversationMember.countDocuments({ userId: req.user._id, locked: true, hidden: true }),
    ]);
    return res.json({
      hasPin: !!user.chatLockPinHash,
      hasSecret: !!user.secretCodeHash,
      lockedCount,
      hiddenCount,
    });
  } catch (err) {
    return next(err);
  }
});

// Set the lock PIN for the first time (4–6 digits, stored as a bcrypt hash).
router.post(
  '/pin',
  validate(z.object({ pin: z.string() })),
  async (req, res, next) => {
    try {
      if (!PIN_PATTERN.test(req.body.pin)) {
        return res.status(400).json({ message: 'PIN must be 4–6 digits' });
      }
      const user = await getSecurityUser(req.user._id);
      if (user.chatLockPinHash) {
        return res.status(400).json({ message: 'A PIN is already set. Use change PIN instead.' });
      }
      user.chatLockPinHash = await User.hashPassword(req.body.pin);
      user.pinFailCount = 0;
      user.pinLockedUntil = null;
      await user.save();
      return res.status(201).json({ ok: true });
    } catch (err) {
      return next(err);
    }
  }
);

// Change PIN: requires the current PIN (verified with the same rate limit).
router.post(
  '/pin/change',
  validate(z.object({ currentPin: z.string(), newPin: z.string() })),
  async (req, res, next) => {
    try {
      if (!PIN_PATTERN.test(req.body.newPin)) {
        return res.status(400).json({ message: 'PIN must be 4–6 digits' });
      }
      const user = await verifyPin(req.user._id, req.body.currentPin);
      user.chatLockPinHash = await User.hashPassword(req.body.newPin);
      await user.save();
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  }
);

// Recovery: forget the PIN by proving knowledge of the account password.
// Locked chats stay locked; the user sets a fresh PIN and unlocks with it.
router.post(
  '/pin/reset',
  validate(z.object({ password: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const user = await getSecurityUser(req.user._id);
      const ok = await bcrypt.compare(req.body.password, user.password || '');
      if (!ok) return res.status(401).json({ message: 'Incorrect password' });
      user.chatLockPinHash = null;
      user.pinFailCount = 0;
      user.pinLockedUntil = null;
      await user.save();
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  }
);

// Verify the PIN and issue the short-lived unlock grant.
router.post(
  '/unlock',
  validate(z.object({ pin: z.string() })),
  async (req, res, next) => {
    try {
      await verifyPin(req.user._id, req.body.pin);
      const { token, expiresAt } = signUnlockToken(req.user._id);
      return res.json({ unlockToken: token, expiresAt });
    } catch (err) {
      return next(err);
    }
  }
);

// Writes below this point about specific conversations need the unlock grant.
function requireGrant(req, res, next) {
  if (!requestUnlocked(req)) {
    return res.status(423).json({ message: 'Locked chats are locked. Enter your PIN first.' });
  }
  return next();
}

// The Locked Chats list: locked, non-hidden conversations, previews included
// ONLY because the caller presented a valid unlock grant.
router.get('/conversations', requireGrant, async (req, res, next) => {
  try {
    const memberships = await ConversationMember.find({
      userId: req.user._id,
      locked: true,
      hidden: false,
    }).select('conversationId');
    const ids = memberships.map((m) => m.conversationId);
    const convs = await populateConv(
      Conversation.find({ _id: { $in: ids } }).sort({ updatedAt: -1 })
    );
    const serialized = [];
    for (const conv of convs) {
      serialized.push(await serializeConversation(conv, req.user._id));
    }
    return res.json({ conversations: serialized });
  } catch (err) {
    return next(err);
  }
});

// Lock a conversation for me (requires a PIN to already be set).
router.post('/:conversationId/lock', async (req, res, next) => {
  try {
    const membership = await requireMembership(req.params.conversationId, req.user._id);
    const user = await getSecurityUser(req.user._id);
    if (!user.chatLockPinHash) {
      throw httpError(400, 'Set a chat lock PIN before locking a chat');
    }
    membership.locked = true;
    await membership.save();
    return res.json({ ok: true, locked: true });
  } catch (err) {
    return next(err);
  }
});

// Remove the lock from a conversation (requires the unlock grant).
router.delete('/:conversationId', requireGrant, async (req, res, next) => {
  try {
    const membership = await requireMembership(req.params.conversationId, req.user._id);
    membership.locked = false;
    membership.hidden = false;
    await membership.save();
    return res.json({ ok: true, locked: false });
  } catch (err) {
    return next(err);
  }
});

// Set the hidden-chat secret code for the first time (hashed, never plain).
router.post(
  '/secret',
  validate(z.object({ secretCode: z.string().min(4).max(64) })),
  async (req, res, next) => {
    try {
      const user = await getSecurityUser(req.user._id);
      if (user.secretCodeHash) {
        return res
          .status(400)
          .json({ message: 'A secret code is already set. Reset it with your password to change it.' });
      }
      user.secretCodeHash = await User.hashPassword(req.body.secretCode);
      user.secretFailCount = 0;
      user.secretLockedUntil = null;
      await user.save();
      return res.status(201).json({ ok: true });
    } catch (err) {
      return next(err);
    }
  }
);

// Recovery for the secret code: password-verified reset also un-hides every
// chat, so a forgotten code can never trap chats invisibly forever.
router.post(
  '/secret/reset',
  validate(z.object({ password: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const user = await getSecurityUser(req.user._id);
      const ok = await bcrypt.compare(req.body.password, user.password || '');
      if (!ok) return res.status(401).json({ message: 'Incorrect password' });
      user.secretCodeHash = null;
      user.secretFailCount = 0;
      user.secretLockedUntil = null;
      await user.save();
      await ConversationMember.updateMany(
        { userId: req.user._id, hidden: true },
        { $set: { hidden: false } }
      );
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  }
);

// Hide / unhide a locked conversation (Module 21). Hiding requires a secret
// code to be set first; unhiding a single chat also requires the grant.
router.post(
  '/:conversationId/hide',
  validate(z.object({ hidden: z.boolean() })),
  async (req, res, next) => {
    try {
      const membership = await requireMembership(req.params.conversationId, req.user._id);
      if (!membership.locked) {
        return res.status(400).json({ message: 'Only a locked chat can be hidden' });
      }
      if (req.body.hidden) {
        const user = await getSecurityUser(req.user._id);
        if (!user.secretCodeHash) {
          return res.status(400).json({ message: 'Set a secret code before hiding chats' });
        }
      } else if (!requestUnlocked(req)) {
        return res.status(423).json({ message: 'Unlock locked chats to unhide a chat' });
      }
      membership.hidden = req.body.hidden;
      await membership.save();
      return res.json({ ok: true, hidden: membership.hidden });
    } catch (err) {
      return next(err);
    }
  }
);

// Reveal hidden chats by entering the secret code (rate-limited). Returns the
// hidden conversations themselves; opening their messages still requires the
// PIN unlock grant like any other locked chat.
router.post(
  '/reveal',
  validate(z.object({ secretCode: z.string().min(1).max(64) })),
  async (req, res, next) => {
    try {
      await verifySecret(req.user._id, req.body.secretCode);
      const memberships = await ConversationMember.find({
        userId: req.user._id,
        locked: true,
        hidden: true,
      }).select('conversationId');
      const ids = memberships.map((m) => m.conversationId);
      const convs = await populateConv(
        Conversation.find({ _id: { $in: ids } }).sort({ updatedAt: -1 })
      );
      const serialized = [];
      for (const conv of convs) {
        serialized.push(await serializeConversation(conv, req.user._id));
      }
      return res.json({ conversations: serialized });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
