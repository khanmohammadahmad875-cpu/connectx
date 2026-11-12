const express = require('express');
const { z } = require('zod');
const Message = require('../models/Message');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  createMessage,
  requireMembership,
  populateMessage,
} = require('../services/messageService');

const router = express.Router();
router.use(requireAuth);

// Paginated history: ?limit=30&before=<messageId>
router.get('/:conversationId', async (req, res, next) => {
  try {
    await requireMembership(req.params.conversationId, req.user._id);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const filter = { conversationId: req.params.conversationId };
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
  messageType: z.enum(['text', 'image', 'file']).optional().default('text'),
  attachmentUrl: z.string().optional().default(''),
  replyTo: z.string().nullable().optional(),
  clientMessageId: z.string().max(80).nullable().optional(),
});

router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const { message, duplicate } = await createMessage({
      conversationId: req.body.conversationId,
      senderId: req.user._id,
      content: req.body.content,
      messageType: req.body.messageType,
      attachmentUrl: req.body.attachmentUrl,
      replyTo: req.body.replyTo || null,
      clientMessageId: req.body.clientMessageId || null,
    });
    if (!duplicate) {
      const io = req.app.get('io');
      if (io) io.to(`conv:${req.body.conversationId}`).emit('new_message', { message });
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

router.delete('/:id', async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ message: 'Message not found' });
    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }
    message.deletedAt = new Date();
    message.content = '';
    message.attachmentUrl = '';
    message.reactions = [];
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

module.exports = router;
