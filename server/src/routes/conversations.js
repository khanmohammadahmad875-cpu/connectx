const express = require('express');
const { z } = require('zod');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Message = require('../models/Message');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireMembership } = require('../services/messageService');
const {
  assertConversationUnlocked,
  requestUnlocked,
} = require('../services/lockService');

const router = express.Router();
router.use(requireAuth);

async function addMembers(conversationId, userIds, adminIds = []) {
  await ConversationMember.insertMany(
    userIds.map((userId) => ({
      conversationId,
      userId,
      role: adminIds.some((a) => a.toString() === userId.toString()) ? 'admin' : 'member',
    })),
    { ordered: false }
  ).catch(() => {}); // ignore duplicates on re-add
}

async function serializeConversation(conv, viewerId) {
  const obj = conv.toObject ? conv.toObject() : { ...conv };
  const myMembership = await ConversationMember.findOne({
    conversationId: conv._id,
    userId: viewerId,
  });
  obj.myRole = myMembership ? myMembership.role : null;
  obj.muted = myMembership ? myMembership.muted : false;
  // Per-user visibility state (Modules 19–21).
  obj.archived = myMembership ? !!myMembership.archived : false;
  obj.locked = myMembership ? !!myMembership.locked : false;
  obj.hidden = myMembership ? !!myMembership.hidden : false;
  if (obj.type === 'channel') {
    obj.followerCount = (obj.participants || []).length;
  }

  // Unread count: messages after my last-read message that I did not send
  // (and did not hide via "delete for me").
  let unread = 0;
  if (myMembership) {
    const filter = {
      conversationId: conv._id,
      senderId: { $ne: viewerId },
      deletedAt: null,
      hiddenFor: { $ne: viewerId },
    };
    if (myMembership.lastReadMessageId) {
      const lastRead = await Message.findById(myMembership.lastReadMessageId).select('createdAt');
      if (lastRead) filter.createdAt = { $gt: lastRead.createdAt };
    }
    unread = await Message.countDocuments(filter);
  }
  obj.unreadCount = unread;

  // If the newest message is hidden for this viewer ("delete for me"), the
  // list preview should show their newest visible message instead.
  const lm = obj.lastMessage;
  if (lm && (lm.hiddenFor || []).some((id) => id.toString() === viewerId.toString())) {
    const fallback = await Message.findOne({
      conversationId: conv._id,
      hiddenFor: { $ne: viewerId },
    })
      .sort({ createdAt: -1 })
      .select('content senderId messageType createdAt deletedAt')
      .populate('senderId', 'username');
    obj.lastMessage = fallback || null;
  }
  return obj;
}

function populateConv(query) {
  return query
    .populate(
      'participants',
      'username profilePicture status lastSeen privacy timezone business.isBusiness business.verified business.name business.category'
    )
    .populate({
      path: 'lastMessage',
      select: 'content senderId messageType createdAt deletedAt hiddenFor',
      populate: { path: 'senderId', select: 'username' },
    })
    .populate('admins', 'username');
}

const createSchema = z.object({
  type: z.enum(['private', 'group', 'channel']),
  participantId: z.string().optional(),
  groupName: z.string().trim().min(1).max(80).optional(),
  groupImage: z.string().optional(),
  description: z.string().trim().max(500).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  memberIds: z.array(z.string()).optional(),
});

router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const me = req.user._id;

    if (req.body.type === 'private') {
      const otherId = req.body.participantId;
      if (!otherId || !mongoose.isValidObjectId(otherId)) {
        return res.status(400).json({ message: 'participantId is required' });
      }
      if (otherId === me.toString()) {
        return res.status(400).json({ message: 'You cannot chat with yourself' });
      }
      const other = await User.findById(otherId);
      if (!other || other.isDeactivated) return res.status(404).json({ message: 'User not found' });
      if ((req.user.blockedUsers || []).some((id) => id.toString() === otherId)) {
        return res.status(403).json({ message: 'You have blocked this user' });
      }
      if ((other.blockedUsers || []).some((id) => id.toString() === me.toString())) {
        return res.status(403).json({ message: 'You cannot message this user' });
      }

      const pairKey = [me.toString(), otherId].sort().join(':');
      let conv = await Conversation.findOne({ pairKey });
      if (!conv) {
        conv = await Conversation.create({
          type: 'private',
          participants: [me, otherId],
          createdBy: me,
          pairKey,
        });
        await addMembers(conv._id, [me, otherId]);
      }
      const populated = await populateConv(Conversation.findById(conv._id));
      return res.status(201).json({ conversation: await serializeConversation(populated, me) });
    }

    if (req.body.type === 'channel') {
      // Broadcast channel (Module 14): creator is owner/admin; everyone else
      // joins as a follower via the follow endpoint or discovery.
      if (!req.body.groupName) return res.status(400).json({ message: 'Channel name is required' });
      const conv = await Conversation.create({
        type: 'channel',
        participants: [me],
        groupName: req.body.groupName,
        groupImage: req.body.groupImage || '',
        description: req.body.description || '',
        visibility: req.body.visibility || 'public',
        admins: [me],
        createdBy: me,
      });
      await addMembers(conv._id, [me], [me]);
      const populated = await populateConv(Conversation.findById(conv._id));
      return res.status(201).json({ conversation: await serializeConversation(populated, me) });
    }

    // group
    const memberIds = [...new Set((req.body.memberIds || []).filter((id) => id !== me.toString()))];
    if (!req.body.groupName) return res.status(400).json({ message: 'groupName is required' });
    const validMembers = await User.find({ _id: { $in: memberIds }, isDeactivated: false });
    if (validMembers.length !== memberIds.length) {
      return res.status(400).json({ message: 'One or more members were not found' });
    }
    const conv = await Conversation.create({
      type: 'group',
      participants: [me, ...memberIds],
      groupName: req.body.groupName,
      groupImage: req.body.groupImage || '',
      admins: [me],
      createdBy: me,
    });
    await addMembers(conv._id, [me, ...memberIds], [me]);
    const populated = await populateConv(Conversation.findById(conv._id));
    return res.status(201).json({ conversation: await serializeConversation(populated, me) });
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    // Main list excludes chats this user archived (Module 20) and locked
    // (Module 19) — locked chats are only served by the chat-locks API after
    // PIN verification, so their previews can never leak here.
    // ?view=archived returns only the archived (and not locked) ones.
    const wantArchived = req.query.view === 'archived';
    const memberships = await ConversationMember.find({
      userId: req.user._id,
      archived: wantArchived,
      locked: false,
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

router.get('/:id', async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user._id);
    await assertConversationUnlocked(req.params.id, req.user._id, requestUnlocked(req));
    const conv = await populateConv(Conversation.findById(req.params.id));
    if (!conv) return res.status(404).json({ message: 'Conversation not found' });
    const out = await serializeConversation(conv, req.user._id);
    const members = await ConversationMember.find({ conversationId: conv._id }).populate(
      'userId',
      'username profilePicture status lastSeen'
    );
    out.members = members;
    return res.json({ conversation: out });
  } catch (err) {
    return next(err);
  }
});

async function requireGroupAdmin(req, res) {
  const membership = await requireMembership(req.params.id, req.user._id);
  const conv = await Conversation.findById(req.params.id);
  if (!conv || conv.type !== 'group') throw Object.assign(new Error('Not a group conversation'), { status: 400 });
  if (membership.role !== 'admin') throw Object.assign(new Error('Only group admins can do this'), { status: 403 });
  return { membership, conv };
}

router.patch('/:id', validate(z.object({
  groupName: z.string().trim().min(1).max(80).optional(),
  groupImage: z.string().optional(),
  description: z.string().trim().max(500).optional(),
  muted: z.boolean().optional(),
})), async (req, res, next) => {
  try {
    const membership = await requireMembership(req.params.id, req.user._id);
    const conv = await Conversation.findById(req.params.id);
    if (req.body.muted !== undefined) {
      membership.muted = req.body.muted;
      await membership.save();
    }
    if (
      req.body.groupName !== undefined ||
      req.body.groupImage !== undefined ||
      req.body.description !== undefined
    ) {
      if ((conv.type !== 'group' && conv.type !== 'channel') || membership.role !== 'admin') {
        return res.status(403).json({ message: 'Only admins can edit conversation details' });
      }
      if (req.body.groupName !== undefined) conv.groupName = req.body.groupName;
      if (req.body.groupImage !== undefined) conv.groupImage = req.body.groupImage;
      if (req.body.description !== undefined) conv.description = req.body.description;
      await conv.save();
    }
    const populated = await populateConv(Conversation.findById(conv._id));
    return res.json({ conversation: await serializeConversation(populated, req.user._id) });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/members', validate(z.object({ userId: z.string() })), async (req, res, next) => {
  try {
    const { conv } = await requireGroupAdmin(req, res);
    const target = await User.findById(req.body.userId);
    if (!target || target.isDeactivated) return res.status(404).json({ message: 'User not found' });
    if (!conv.participants.some((p) => p.toString() === target._id.toString())) {
      conv.participants.push(target._id);
      await conv.save();
    }
    await addMembers(conv._id, [target._id]);
    const populated = await populateConv(Conversation.findById(conv._id));
    return res.json({ conversation: await serializeConversation(populated, req.user._id) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    const { conv } = await requireGroupAdmin(req, res);
    if (req.params.userId === conv.createdBy.toString()) {
      return res.status(400).json({ message: 'The group creator cannot be removed' });
    }
    conv.participants = conv.participants.filter((p) => p.toString() !== req.params.userId);
    conv.admins = conv.admins.filter((a) => a.toString() !== req.params.userId);
    await conv.save();
    await ConversationMember.deleteOne({ conversationId: conv._id, userId: req.params.userId });
    return res.json({ message: 'Member removed' });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/admins', validate(z.object({ userId: z.string() })), async (req, res, next) => {
  try {
    const { conv } = await requireGroupAdmin(req, res);
    const membership = await ConversationMember.findOne({
      conversationId: conv._id,
      userId: req.body.userId,
    });
    if (!membership) return res.status(404).json({ message: 'That user is not a member' });
    membership.role = 'admin';
    await membership.save();
    if (!conv.admins.some((a) => a.toString() === req.body.userId)) {
      conv.admins.push(req.body.userId);
      await conv.save();
    }
    return res.json({ message: 'Admin assigned' });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/leave', async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user._id);
    const conv = await Conversation.findById(req.params.id);
    if (conv.type === 'group') {
      conv.participants = conv.participants.filter((p) => p.toString() !== req.user._id.toString());
      conv.admins = conv.admins.filter((a) => a.toString() !== req.user._id.toString());
      await conv.save();
    }
    await ConversationMember.deleteOne({ conversationId: conv._id, userId: req.user._id });
    return res.json({ message: 'Left the conversation' });
  } catch (err) {
    return next(err);
  }
});

// Mark everything in this conversation as read by me.
router.post('/:id/read', async (req, res, next) => {
  try {
    const membership = await requireMembership(req.params.id, req.user._id);
    await assertConversationUnlocked(req.params.id, req.user._id, requestUnlocked(req));
    const latest = await Message.findOne({ conversationId: req.params.id }).sort({ createdAt: -1 });
    if (latest) {
      membership.lastReadMessageId = latest._id;
      await membership.save();
      await Message.updateMany(
        {
          conversationId: req.params.id,
          senderId: { $ne: req.user._id },
          readBy: { $ne: req.user._id },
        },
        { $addToSet: { readBy: req.user._id } }
      );
      const io = req.app.get('io');
      if (io) {
        io.to(`conv:${req.params.id}`).emit('message_read', {
          conversationId: req.params.id,
          userId: req.user._id.toString(),
        });
      }
    }
    return res.json({ message: 'Marked as read' });
  } catch (err) {
    return next(err);
  }
});

// --- Archive (Module 20) ------------------------------------------------------
// Per-user visibility only: archiving never affects other participants.
router.post('/:id/archive', async (req, res, next) => {
  try {
    const membership = await requireMembership(req.params.id, req.user._id);
    membership.archived = true;
    await membership.save();
    return res.json({ ok: true, archived: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/unarchive', async (req, res, next) => {
  try {
    const membership = await requireMembership(req.params.id, req.user._id);
    membership.archived = false;
    await membership.save();
    return res.json({ ok: true, archived: false });
  } catch (err) {
    return next(err);
  }
});

// --- Channels: follow / unfollow (Module 14) ----------------------------------
// Public channels can be followed by anyone; private channels only by users
// who are already members (added by an admin through the members flow).
router.post('/:id/follow', async (req, res, next) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv || conv.type !== 'channel') {
      return res.status(404).json({ message: 'Channel not found' });
    }
    const existing = await ConversationMember.findOne({
      conversationId: conv._id,
      userId: req.user._id,
    });
    if (existing) {
      const populated = await populateConv(Conversation.findById(conv._id));
      return res.json({ conversation: await serializeConversation(populated, req.user._id) });
    }
    if (conv.visibility !== 'public') {
      return res.status(403).json({ message: 'This channel is private' });
    }
    if (!conv.participants.some((p) => p.toString() === req.user._id.toString())) {
      conv.participants.push(req.user._id);
      await conv.save();
    }
    await addMembers(conv._id, [req.user._id]);
    const populated = await populateConv(Conversation.findById(conv._id));
    return res.status(201).json({ conversation: await serializeConversation(populated, req.user._id) });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/unfollow', async (req, res, next) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv || conv.type !== 'channel') {
      return res.status(404).json({ message: 'Channel not found' });
    }
    if (conv.createdBy && conv.createdBy.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'The channel owner cannot unfollow their own channel' });
    }
    conv.participants = conv.participants.filter(
      (p) => p.toString() !== req.user._id.toString()
    );
    await conv.save();
    await ConversationMember.deleteOne({ conversationId: conv._id, userId: req.user._id });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.serializeConversation = serializeConversation;
module.exports.populateConv = populateConv;
module.exports.addMembers = addMembers;
