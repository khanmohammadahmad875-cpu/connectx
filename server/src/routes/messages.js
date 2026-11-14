const express = require('express');
const { z } = require('zod');
const Message = require('../models/Message');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  createMessage,
  requireMembership,
  populateMessage,
  notExpired,
} = require('../services/messageService');
const {
  assertConversationUnlocked,
  requestUnlocked,
} = require('../services/lockService');

const router = express.Router();
router.use(requireAuth);

// Paginated history: ?limit=30&before=<messageId>
router.get('/:conversationId', async (req, res, next) => {
  try {
    await requireMembership(req.params.conversationId, req.user._id);
    // Chat lock (Module 19): history is refused server-side while locked.
    await assertConversationUnlocked(
      req.params.conversationId,
      req.user._id,
      requestUnlocked(req)
    );
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    // "Delete for me": messages this user hid never come back in their history.
    // Disappearing messages: expired ones are filtered out of history too.
    const filter = {
      conversationId: req.params.conversationId,
      hiddenFor: { $ne: req.user._id },
      ...notExpired(),
    };
    if (req.query.before) {
      const beforeMsg = await Message.findById(req.query.before).select('createdAt');
      if (beforeMsg) filter.createdAt = { $lt: beforeMsg.createdAt };
    }
    const messages = await populateMessage(
      Message.find(filter).sort({ createdAt: -1 }).limit(limit)
    );
    return res.json({ messages: messages.reverse() }); // oldest -> newest for display
  } catch (err) {
    return next(err);
  }
});

const createSchema = z.object({
  conversationId: z.string(),
  content: z.string().max(4000).optional().default(''),
  // 'call' and 'live_location' are intentionally absent: call messages are
  // server-only and live location starts through /api/live-location.
  messageType: z.enum(['text', 'image', 'file', 'audio', 'video', 'poll', 'location']).optional().default('text'),
  attachmentUrl: z.string().optional().default(''),
  replyTo: z.string().nullable().optional(),
  clientMessageId: z.string().max(80).nullable().optional(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      label: z.string().max(120).optional().default(''),
    })
    .optional(),
  audioMeta: z
    .object({
      duration: z.number().min(0).max(3600).optional(),
      waveform: z.array(z.number()).max(64).optional(),
    })
    .optional(),
  videoMeta: z
    .object({
      duration: z.number().min(0).max(86400).optional(),
      size: z.number().min(0).max(64 * 1024 * 1024).optional(),
      mime: z.string().max(100).optional(),
    })
    .optional(),
  poll: z
    .object({
      question: z.string().trim().min(1).max(300),
      options: z.array(z.string().trim().min(1).max(200)).min(2).max(10),
      allowMultiple: z.boolean().optional().default(false),
    })
    .optional(),
});

router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const { message, duplicate, autoReplies } = await createMessage({
      conversationId: req.body.conversationId,
      senderId: req.user._id,
      content: req.body.content,
      messageType: req.body.messageType,
      attachmentUrl: req.body.attachmentUrl,
      replyTo: req.body.replyTo || null,
      clientMessageId: req.body.clientMessageId || null,
      audioMeta: req.body.audioMeta || null,
      videoMeta: req.body.videoMeta || null,
      poll: req.body.poll || null,
      location: req.body.location || null,
      unlocked: requestUnlocked(req),
    });
    if (!duplicate) {
      const io = req.app.get('io');
      if (io) {
        io.to(`conv:${req.body.conversationId}`).emit('new_message', { message });
        // Business welcome/away auto-messages arrive right behind it.
        for (const auto of autoReplies || []) {
          io.to(`conv:${req.body.conversationId}`).emit('new_message', { message: auto });
        }
      }
    }
    return res.status(duplicate ? 200 : 201).json({ message, duplicate });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', validate(z.object({ content: z.string().min(1).max(4000) })), async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ message: 'Message not found' });
    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only edit your own messages' });
    }
    await requireMembership(message.conversationId, req.user._id);
    await assertConversationUnlocked(message.conversationId, req.user._id, requestUnlocked(req));
    message.content = req.body.content.trim();
    message.editedAt = new Date();
    await message.save();
    const populated = await populateMessage(Message.findById(message._id));
    const io = req.app.get('io');
    if (io) io.to(`conv:${message.conversationId}`).emit('message_updated', { message: populated });
    return res.json({ message: populated });
  } catch (err) {
    return next(err);
  }
});

// "Delete for me": hide the message for the requesting user only. Any member
// of the conversation can do this; nobody else is affected and nothing is
// broadcast — other participants keep seeing the message untouched.
router.post('/:id/hide', async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    await requireMembership(message.conversationId, req.user._id);
    await assertConversationUnlocked(message.conversationId, req.user._id, requestUnlocked(req));
    await Message.updateOne(
      { _id: message._id },
      { $addToSet: { hiddenFor: req.user._id } }
    );
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// "Delete for everyone": sender only. Soft-deletes for all participants and
// broadcasts message_updated so every open client re-renders it as deleted.
router.delete('/:id', async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ message: 'Message not found' });
    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }
    await assertConversationUnlocked(message.conversationId, req.user._id, requestUnlocked(req));
    message.deletedAt = new Date();
    message.content = '';
    message.attachmentUrl = '';
    message.reactions = [];
    message.poll = undefined;
    message.audioMeta = { duration: 0, waveform: [] };
    message.location = undefined;
    message.liveLocation = undefined;
    await message.save();
    const populated = await populateMessage(Message.findById(message._id));
    const io = req.app.get('io');
    if (io) io.to(`conv:${message.conversationId}`).emit('message_updated', { message: populated });
    return res.json({ message: populated });
  } catch (err) {
    return next(err);
  }
});

// Toggle a reaction: sending the same emoji again removes it.
router.post('/:id/reactions', validate(z.object({ emoji: z.string().min(1).max(8) })), async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ message: 'Message not found' });
    await requireMembership(message.conversationId, req.user._id);
    await assertConversationUnlocked(message.conversationId, req.user._id, requestUnlocked(req));
    const mine = message.reactions.find(
      (r) => r.user.toString() === req.user._id.toString() && r.emoji === req.body.emoji
    );
    if (mine) {
      message.reactions = message.reactions.filter((r) => r !== mine);
    } else {
      message.reactions = message.reactions.filter(
        (r) => r.user.toString() !== req.user._id.toString()
      );
      message.reactions.push({ user: req.user._id, emoji: req.body.emoji });
    }
    await message.save();
    const populated = await populateMessage(Message.findById(message._id));
    const io = req.app.get('io');
    if (io) io.to(`conv:${message.conversationId}`).emit('message_updated', { message: populated });
    return res.json({ message: populated });
  } catch (err) {
    return next(err);
  }
});

// --- Polls -------------------------------------------------------------------
// Vote: body { optionIds: [...] } replaces the caller's vote set (an empty
// array unvotes). Single-choice polls accept at most one option. Results are
// derived from the persisted votes and broadcast live via message_updated.
router.post(
  '/:id/vote',
  validate(z.object({ optionIds: z.array(z.string()).max(10) })),
  async (req, res, next) => {
    try {
      const message = await Message.findById(req.params.id);
      if (!message || message.deletedAt || message.messageType !== 'poll' || !message.poll) {
        return res.status(404).json({ message: 'Poll not found' });
      }
      await requireMembership(message.conversationId, req.user._id);
      await assertConversationUnlocked(message.conversationId, req.user._id, requestUnlocked(req));
      if (message.poll.closed) {
        return res.status(400).json({ message: 'This poll is closed' });
      }
      const validIds = new Set(message.poll.options.map((o) => o._id.toString()));
      const chosen = [...new Set(req.body.optionIds)].filter((id) => validIds.has(id));
      if (chosen.length !== new Set(req.body.optionIds).size) {
        return res.status(400).json({ message: 'Unknown poll option' });
      }
      if (!message.poll.allowMultiple && chosen.length > 1) {
        return res.status(400).json({ message: 'This poll allows only one choice' });
      }
      const me = req.user._id.toString();
      for (const option of message.poll.options) {
        option.votes = option.votes.filter((v) => v.toString() !== me);
        if (chosen.includes(option._id.toString())) option.votes.push(req.user._id);
      }
      await message.save();
      const populated = await populateMessage(Message.findById(message._id));
      const io = req.app.get('io');
      if (io) io.to(`conv:${message.conversationId}`).emit('message_updated', { message: populated });
      return res.json({ message: populated });
    } catch (err) {
      return next(err);
    }
  }
);

// Close a poll: only the poll's creator (the message sender) may close it.
router.post('/:id/poll/close', async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt || message.messageType !== 'poll' || !message.poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }
    await requireMembership(message.conversationId, req.user._id);
    await assertConversationUnlocked(message.conversationId, req.user._id, requestUnlocked(req));
    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the poll creator can close this poll' });
    }
    message.poll.closed = true;
    await message.save();
    const populated = await populateMessage(Message.findById(message._id));
    const io = req.app.get('io');
    if (io) io.to(`conv:${message.conversationId}`).emit('message_updated', { message: populated });
    return res.json({ message: populated });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
