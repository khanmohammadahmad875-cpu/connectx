const express = require('express');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Discover public channels (Module 14). Only public channels are listed —
// private channels never appear in discovery. Each row carries the follower
// count and whether the caller already follows, never any message content.
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const filter = { type: 'channel', visibility: 'public' };
    if (q) filter.groupName = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const channels = await Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate('createdBy', 'username');
    const myMemberships = await ConversationMember.find({ userId: req.user._id }).select(
      'conversationId role'
    );
    const mine = new Map(myMemberships.map((m) => [m.conversationId.toString(), m.role]));
    return res.json({
      channels: channels.map((c) => ({
        _id: c._id,
        name: c.groupName,
        description: c.description || '',
        avatar: c.groupImage || '',
        visibility: c.visibility,
        followerCount: (c.participants || []).length,
        owner: c.createdBy ? { _id: c.createdBy._id, username: c.createdBy.username } : null,
        following: mine.has(c._id.toString()),
        myRole: mine.get(c._id.toString()) || null,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
