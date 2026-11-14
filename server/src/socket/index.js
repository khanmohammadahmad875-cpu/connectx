const { Server } = require('socket.io');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const { verifyAccessToken, verifyUnlockPayload } = require('../utils/tokens');
const { createMessage, requireMembership } = require('../services/messageService');
const callService = require('../services/callService');
const { updateLiveLocation } = require('../services/liveLocationService');

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
  callService.init(io);

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
    socket.data.unlockedUntil = 0;

    // Chat lock (Module 19): the client presents the unlock grant it received
    // from POST /api/chat-locks/unlock; this socket may then read/send in the
    // user's locked conversations until the grant expires.
    const socketUnlocked = () => Date.now() < (socket.data.unlockedUntil || 0);
    socket.on('unlock_chats', ({ token } = {}, ack) => {
      const payload = verifyUnlockPayload(token, userId);
      if (!payload) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Invalid unlock token' });
        return;
      }
      socket.data.unlockedUntil = payload.exp * 1000;
      if (typeof ack === 'function') ack({ ok: true, expiresAt: socket.data.unlockedUntil });
    });

    const wasOffline = !isOnline(userId);
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    if (wasOffline) {
      await User.findByIdAndUpdate(userId, { status: 'online' });
      io.emit('user_online', { userId });
    }

    socket.on('join_conversation', async ({ conversationId } = {}, ack) => {
      try {
        const membership = await requireMembership(conversationId, userId);
        if (membership.locked && !socketUnlocked()) {
          if (typeof ack === 'function') ack({ ok: false, error: 'This chat is locked' });
          return;
        }
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
        const { message, duplicate, autoReplies } = await createMessage({
          conversationId: payload.conversationId,
          senderId: userId,
          content: payload.content || '',
          messageType: payload.messageType || 'text',
          attachmentUrl: payload.attachmentUrl || '',
          replyTo: payload.replyTo || null,
          clientMessageId: payload.clientMessageId || null,
          audioMeta: payload.audioMeta || null,
          videoMeta: payload.videoMeta || null,
          poll: payload.poll || null,
          location: payload.location || null,
          unlocked: socketUnlocked(),
        });

        if (!duplicate) {
          io.to(`conv:${payload.conversationId}`).emit('new_message', { message });
          for (const auto of autoReplies || []) {
            io.to(`conv:${payload.conversationId}`).emit('new_message', { message: auto });
          }

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
        const membership = await requireMembership(conversationId, userId);
        if (membership.locked && !socketUnlocked()) return;
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
        if (membership.locked && !socketUnlocked()) return;
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

    // --- Voice/video calls (module 8): WebRTC signalling -------------------
    // Every event re-verifies, server-side, that the socket's user is a
    // party to the call / a member of the conversation. SDP payloads are
    // relayed only between the two parties of a verified private
    // conversation — a stranger cannot signal a user they share nothing
    // with because the invite requires membership in a private conversation
    // with that user.
    socket.on('call_invite', async ({ conversationId, callType, offer } = {}, ack) => {
      const reply = (obj) => {
        if (typeof ack === 'function') ack(obj);
      };
      try {
        if (!conversationId || !offer || !['voice', 'video'].includes(callType)) {
          return reply({ ok: false, error: 'Invalid call invite' });
        }
        const membership = await requireMembership(conversationId, userId);
        if (membership.locked && !socketUnlocked()) {
          return reply({ ok: false, error: 'This chat is locked' });
        }
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || conversation.type !== 'private') {
          return reply({ ok: false, error: 'Calls are only available in private conversations' });
        }
        const calleeId = (conversation.participants || [])
          .map((p) => p.toString())
          .find((id) => id !== userId);
        if (!calleeId) return reply({ ok: false, error: 'There is no one to call' });
        const callee = await User.findById(calleeId);
        if (!callee || callee.isDeactivated) {
          return reply({ ok: false, error: 'This user is unavailable' });
        }
        const blockedEitherWay =
          (socket.user.blockedUsers || []).some((id) => id.toString() === calleeId) ||
          (callee.blockedUsers || []).some((id) => id.toString() === userId);
        if (blockedEitherWay) return reply({ ok: false, error: 'You cannot call this user' });
        if (callService.activeCallIdForUser(userId)) {
          return reply({ ok: false, error: 'You are already in a call' });
        }
        if (callService.activeCallIdForUser(calleeId)) {
          await callService.recordBusyCall({
            callerId: userId,
            calleeId,
            conversationId,
            type: callType,
          });
          return reply({ ok: false, error: 'User is busy', busy: true });
        }
        const call = await callService.startCall({
          callerId: userId,
          calleeId,
          conversationId,
          type: callType,
        });
        io.to(`user:${calleeId}`).emit('incoming_call', {
          callId: call._id.toString(),
          conversationId: conversationId.toString(),
          callType,
          offer,
          caller: {
            _id: socket.user._id,
            username: socket.user.username,
            profilePicture: socket.user.privacy?.showProfilePicture
              ? socket.user.profilePicture
              : '',
          },
        });
        return reply({ ok: true, callId: call._id.toString() });
      } catch (err) {
        return reply({ ok: false, error: err.message });
      }
    });

    // Loads a call and checks the socket user is one of its two parties.
    const partyCall = async (callId) => {
      const call = await callService.getCall(callId);
      if (!call || !callService.isParty(call, userId)) return null;
      return call;
    };

    socket.on('call_accept', async ({ callId, answer } = {}) => {
      const call = await partyCall(callId);
      if (!call || call.status !== 'ringing') return;
      if (call.calleeId.toString() !== userId) return; // only the callee answers
      const updated = await callService.markAnswered(callId);
      if (!updated) return;
      io.to(`user:${call.callerId}`).emit('call_accepted', { callId, answer });
    });

    socket.on('call_reject', async ({ callId } = {}) => {
      const call = await partyCall(callId);
      if (!call || call.status !== 'ringing') return;
      if (call.calleeId.toString() !== userId) return;
      await callService.finalizeCall(callId, 'declined', 'rejected');
    });

    socket.on('call_end', async ({ callId } = {}) => {
      const call = await partyCall(callId);
      if (!call) return;
      if (call.status === 'ongoing') {
        await callService.finalizeCall(callId, 'completed', 'ended');
      } else if (call.status === 'ringing') {
        if (call.callerId.toString() === userId) {
          await callService.finalizeCall(callId, 'missed', 'cancelled');
        } else {
          await callService.finalizeCall(callId, 'declined', 'rejected');
        }
      }
    });

    socket.on('call_ice', async ({ callId, candidate } = {}) => {
      const call = await partyCall(callId);
      if (!call || (call.status !== 'ringing' && call.status !== 'ongoing')) return;
      if (candidate === undefined) return;
      io.to(`user:${callService.otherParty(call, userId)}`).emit('call_ice', {
        callId,
        candidate,
      });
    });

    // --- Live location (module 29): throttled position updates -------------
    // The REST twin (POST /api/live-location/:id/update) shares the same
    // service, so sharer-ownership + stop/expiry rules are identical.
    socket.on('live_location_update', async ({ sessionId, latitude, longitude } = {}, ack) => {
      const reply = (obj) => {
        if (typeof ack === 'function') ack(obj);
      };
      try {
        const session = await updateLiveLocation({
          sessionId,
          userId,
          latitude,
          longitude,
        });
        io.to(`conv:${session.conversationId}`).emit('live_location_update', {
          sessionId: session._id.toString(),
          conversationId: session.conversationId.toString(),
          messageId: session.messageId ? session.messageId.toString() : null,
          latitude: session.latitude,
          longitude: session.longitude,
          expiresAt: session.expiresAt,
          stoppedAt: null,
        });
        return reply({ ok: true });
      } catch (err) {
        return reply({ ok: false, error: err.message });
      }
    });

    socket.on('disconnect', async () => {
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUsers.delete(userId);
          // The user's last session went away mid-call: resolve the call
          // instead of leaving the other party hanging.
          await callService.endCallsForUser(userId).catch(() => {});
          await User.findByIdAndUpdate(userId, { status: 'offline', lastSeen: new Date() });
          io.emit('user_offline', { userId });
        }
      }
    });
  });

  return io;
}

module.exports = { initSocket, isOnline };
