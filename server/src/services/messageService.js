const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Notification = require('../models/Notification');

async function requireMembership(conversationId, userId) {
  const member = await ConversationMember.findOne({ conversationId, userId });
  if (!member) {
    const err = new Error('You are not a member of this conversation');
    err.status = 403;
    throw err;
  }
  return member;
}

function populateMessage(query) {
  return query
    .populate('senderId', 'username profilePicture')
    .populate({
      path: 'replyTo',
      select: 'content senderId messageType deletedAt',
      populate: { path: 'senderId', select: 'username' },
    });
}

/**
 * Creates a message (shared by REST and Socket.IO).
 * Idempotent: when clientMessageId was already used by this sender, the
 * existing message is returned with duplicate=true and nothing is re-created.
 */
async function createMessage({
  conversationId,
  senderId,
  content = '',
  messageType = 'text',
  attachmentUrl = '',
  replyTo = null,
  clientMessageId = null,
}) {
  await requireMembership(conversationId, senderId);

  if (clientMessageId) {
    const existing = await Message.findOne({ senderId, clientMessageId });
    if (existing) {
      return { message: await populateMessage(Message.findById(existing._id)), duplicate: true };
    }
  }

  if (messageType === 'text' && !content.trim() && !attachmentUrl) {
    const err = new Error('Message content is empty');
    err.status = 400;
    throw err;
  }

  let message;
  try {
    message = await Message.create({
      conversationId,
      senderId,
      content: content.trim(),
      messageType,
      attachmentUrl,
      replyTo: replyTo || null,
      clientMessageId: clientMessageId || null,
      readBy: [senderId],
      deliveredTo: [senderId],
    });
  } catch (err) {
    // Race: a duplicate insert hit the unique (senderId, clientMessageId) index.
    if (err.code === 11000 && clientMessageId) {
      const existing = await Message.findOne({ senderId, clientMessageId });
      if (existing) {
        return { message: await populateMessage(Message.findById(existing._id)), duplicate: true };
      }
    }
    throw err;
  }

  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessage: message._id,
    updatedAt: new Date(),
  });

  // Notifications for every other member (they can mute per conversation).
  const members = await ConversationMember.find({ conversationId });
  const toNotify = members.filter(
    (m) => m.userId.toString() !== senderId.toString() && !m.muted
  );
  if (toNotify.length) {
    await Notification.insertMany(
      toNotify.map((m) => ({
        recipientId: m.userId,
        senderId,
        type: 'message',
        conversationId,
        messageId: message._id,
      }))
    );
  }

  return { message: await populateMessage(Message.findById(message._id)), duplicate: false };
}

module.exports = { createMessage, requireMembership, populateMessage };
