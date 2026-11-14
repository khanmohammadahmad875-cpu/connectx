const express = require('express');
const { z } = require('zod');
const Status = require('../models/Status');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;

// Users who share at least one conversation with me (my "contacts" for status).
async function contactIdsFor(userId) {
  const memberships = await ConversationMember.find({ userId }).select('conversationId');
  const convIds = memberships.map((m) => m.conversationId);
  if (!convIds.length) return [];
  const peers = await ConversationMember.find({
    conversationId: { $in: convIds },
    userId: { $ne: userId },
  }).select('userId');
  return [...new Set(peers.map((p) => p.userId.toString()))];
}

function serializeStatus(status, viewerId) {
  const obj = status.toObject ? status.toObject() : { ...status };
  const ownerId = (status.user && status.user._id ? status.user._id : status.user).toString();
  const mine = ownerId === viewerId.toString();
  obj.viewedByMe = (status.viewers || []).some(
    (v) => (v.user && (v.user._id || v.user)).toString() === viewerId.toString()
  );
  obj.viewersCount = (status.viewers || []).length;
  if (!mine) {
    // Only the owner sees who viewed their status.
    obj.viewers = [];
  }
  return obj;
}

const createSchema = z
  .object({
    type: z.enum(['image', 'text']),
    mediaUrl: z.string().max(2000).optional().default(''),
    text: z.string().max(700).optional().default(''),
    backgroundColor: z.string().max(32).optional().default('#2f7bff'),
  })
  .refine((d) => (d.type === 'image' ? d.mediaUrl.trim().length > 0 : d.text.trim().length > 0), {
    message: 'An image status needs mediaUrl and a text status needs text',
  });

// Create a status; it expires exactly 24 hours from now.
router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const now = new Date();
    const status = await Status.create({
      user: req.user._id,
      type: req.body.type,
      mediaUrl: req.body.type === 'image' ? req.body.mediaUrl : '',
      text: req.body.type === 'text' ? req.body.text.trim() : '',
      backgroundColor: req.body.backgroundColor || '#2f7bff',
      expiresAt: new Date(now.getTime() + DAY_MS),
    });
    const populated = await Status.findById(status._id).populate('user', 'username profilePicture');
    return res.status(201).json({ status: serializeStatus(populated, req.user._id) });
  } catch (err) {
    return next(err);
  }
});

// Feed: my statuses + contacts' statuses, unexpired, grouped by user.
// Order: mine first, then groups with unviewed statuses, then most recent.
router.get('/feed', async (req, res, next) => {
  try {
    const me = req.user._id;
    const contactIds = await contactIdsFor(me);
    const authorIds = [me.toString(), ...contactIds];
    const statuses = await Status.find({
      user: { $in: authorIds },
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: 1 })
      .populate('user', 'username profilePicture')
      .populate('viewers.user', 'username profilePicture');

    const byUser = new Map();
    for (const s of statuses) {
      const key = s.user._id.toString();
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key).push(s);
    }

    const groups = [];
    for (const [uid, list] of byUser.entries()) {
      const serialized = list.map((s) => serializeStatus(s, me));
      const mine = uid === me.toString();
      groups.push({
        user: list[0].user,
        mine,
        statuses: serialized,
        hasUnviewed: !mine && serialized.some((s) => !s.viewedByMe),
        latestAt: list[list.length - 1].createdAt,
      });
    }
    groups.sort((a, b) => {
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
      return new Date(b.latestAt) - new Date(a.latestAt);
    });
    return res.json({ groups });
  } catch (err) {
    return next(err);
  }
});

// Record that I viewed someone's status (once — repeat views are no-ops).
router.post('/:id/view', async (req, res, next) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status || status.expiresAt <= new Date()) {
      return res.status(404).json({ message: 'Status not found' });
    }
    const me = req.user._id;
    if (status.user.toString() === me.toString()) {
      return res.json({ ok: true, viewed: false }); // owners don't view their own
    }
    const shared = await Conversation.findOne({
      participants: { $all: [me, status.user] },
    });
    if (!shared) {
      return res.status(403).json({ message: 'You cannot view this status' });
    }
    const already = status.viewers.some((v) => v.user.toString() === me.toString());
    if (!already) {
      status.viewers.push({ user: me, viewedAt: new Date() });
      await status.save();
    }
    return res.json({ ok: true, viewed: true });
  } catch (err) {
    return next(err);
  }
});

// Delete my own status.
router.delete('/:id', async (req, res, next) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: 'Status not found' });
    if (status.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only delete your own status' });
    }
    await status.deleteOne();
    return res.json({ message: 'Status deleted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
