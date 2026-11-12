const { Server } = require('socket.io');
const User = require('../models/User');
const Message = require('../models/Message');
const ConversationMember = require('../models/ConversationMember');
const { verifyAccessToken } = require('../utils/tokens');
const { createMessage, requireMembership } = require('../services/messageService');

// Presence with multi-session support: userId -> Set<socketId>.
// A user is online while at least one session is connected.
const onlineUsers = new Map();

function isOnline(userId) {
  const set = onlineUsers.get(userId.toString());
  return !!set && set.size > 0;
}

function initSocket(httpServer, clientUrl) {
  const io = new Server(httpServer, {
    cors: { origin: clientUrl, credentials: true },
  });

  // Authenticate every socket connection with the access token.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('Unauthorized'));
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub);
      if (!user || user.isDeactivated || user.isBlocked) return next(new Error('Unauthorized'));
      socket.user = user;
      return next();
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user._id.toString();
    socket.join(`user:${userId}`);

    const wasOffline = !isOnline(userId);
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    if (wasOffline) {
      await User.findByIdAndUpdate(userId, { status: 'online' });
      io.emit('user_online', { userId });
    }

    socket.on('join_conversation', async ({ conversationId } = {}, ack) => {
      try {
        await requireMembership(conversationId, userId);
        socket.join(`conv:${conversationId}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('leave_conversation', ({ conversationId } = {}) => {
      if (conversationId) socket.leave(`conv:${conversationId}`);
    });

    socket.on('send_message', async (payload = {}, ack) => {
      try {
        // Never trust a client-supplied sender id: the sender is the socket's user.
        const { message, duplicate } = await createMessage({
          conversationId: payload.conversationId,
          senderId: userId,
          content: payload.content || '',
          messageType: payload.messageType || 'text',
          attachmentUrl: payload.attachmentUrl || '',
          replyTo: payload.replyTo || null,
          clientMessageId: payload.clientMessageId || null,
        });

        if (!duplicate) {
          io.to(`conv:${payload.conversationId}`).emit('new_message', { message });

          // Delivery receipts: members who are online receive it now.
          const members = await ConversationMember.find({
            conversationId: payload.conversationId,
          });
          const onlineOthers = members
            .map((m) => m.userId.toString())
            .filter((id) => id !== userId && isOnline(id));
          if (onlineOthers.length) {
            await Message.findByIdAndUpdate(message._id, {
              $addToSet: { deliveredTo: { $each: onlineOthers } },
            });
            for (const otherId of onlineOthers) {
              io.to(`user:${userId}`).emit('message_delivered', {
                messageId: message._id.toString(),
                conversationId: payload.conversationId,
                userId: otherId,
              });
            }
          }
        }
        if (typeof ack === 'function') ack({ ok: true, message, duplicate });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    const typing = (event) => async ({ conversationId } = {}) => {
      try {
        await requireMembership(conversationId, userId);
        socket.to(`conv:${conversationId}`).emit(event, {
          conversationId,
          userId,
          username: socket.user.username,
        });
      } catch (err) {
        /* ignore typing from non-members */
      }
    };
    socket.on('typing_start', typing('typing_start'));
    socket.on('typing_stop', typing('typing_stop'));

    socket.on('message_read', async ({ conversationId } = {}) => {
      try {
        const membership = await requireMembership(conversationId, userId);
        const latest = await Message.findOne({ conversationId }).sort({ createdAt: -1 });
        if (!latest) return;
        membership.lastReadMessageId = latest._id;
        await membership.save();
        await Message.updateMany(
          { conversationId, senderId: { $ne: userId }, readBy: { $ne: userId } },
          { $addToSet: { readBy: userId } }
        );
        io.to(`conv:${conversationId}`).emit('message_read', { conversationId, userId });
      } catch (err) {
        /* ignore read receipts from non-members */
      }
    });

    socket.on('disconnect', async () => {
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUsers.delete(userId);
          await User.findByIdAndUpdate(userId, { status: 'offline', lastSeen: new Date() });
          io.emit('user_offline', { userId });
        }
      }
    });
  });

  return io;
}

module.exports = { initSocket, isOnline };
