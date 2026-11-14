// 1-to-1 voice/video call state (SRS v2.0 module 8).
//
// Signalling (SDP/ICE relay) lives in the socket layer; this service owns
// the call lifecycle: the persisted Call record, the in-memory active-call
// index, the ring timeout, and finalization — which writes the system
// message into the conversation and, for missed calls, the notification.
//
// There is deliberately no leak path for locked chats: finalization only
// writes *inside* the conversation, and the notifications feed already
// withholds every payload belonging to a conversation the recipient locked.
const Call = require('../models/Call');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Notification = require('../models/Notification');
const { populateMessage } = require('./messageService');

const RING_TIMEOUT_MS = Number(process.env.CALL_RING_TIMEOUT_MS) || 30000;

let ioRef = null;
const activeById = new Map(); // callId -> { ringTimer }
const activeByUser = new Map(); // userId -> callId

function init(io) {
  ioRef = io;
}

function formatDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function systemText(call) {
  const icon = call.type === 'video' ? '📹' : '📞';
  const label = call.type === 'video' ? 'Video' : 'Voice';
  if (call.status === 'completed') {
    return `${icon} ${label} call · ${formatDuration(call.durationSec)}`;
  }
  if (call.status === 'missed') return `${icon} Missed ${label.toLowerCase()} call`;
  if (call.status === 'declined') return `${icon} Declined ${label.toLowerCase()} call`;
  return `${icon} ${label} call`;
}

function activeCallIdForUser(userId) {
  return activeByUser.get(userId.toString()) || null;
}

async function getCall(callId) {
  if (!callId) return null;
  return Call.findById(callId);
}

function isParty(call, userId) {
  if (!call) return false;
  const id = userId.toString();
  return call.callerId.toString() === id || call.calleeId.toString() === id;
}

function otherParty(call, userId) {
  return call.callerId.toString() === userId.toString()
    ? call.calleeId.toString()
    : call.callerId.toString();
}

// Creates the ringing call record and arms the ring timeout. The caller is
// responsible for the busy check first (see activeCallIdForUser).
async function startCall({ callerId, calleeId, conversationId, type }) {
  const call = await Call.create({
    callerId,
    calleeId,
    conversationId,
    type,
    status: 'ringing',
  });
  const callId = call._id.toString();
  const ringTimer = setTimeout(() => {
    finalizeCall(callId, 'missed', 'timeout').catch(() => {});
  }, RING_TIMEOUT_MS);
  if (ringTimer.unref) ringTimer.unref();
  activeById.set(callId, { ringTimer });
  activeByUser.set(callerId.toString(), callId);
  activeByUser.set(calleeId.toString(), callId);
  return call;
}

async function markAnswered(callId) {
  const call = await getCall(callId);
  if (!call || call.status !== 'ringing') return null;
  const slot = activeById.get(callId.toString());
  if (slot) clearTimeout(slot.ringTimer);
  call.status = 'ongoing';
  call.answeredAt = new Date();
  await call.save();
  return call;
}

// Writes the system message for a resolved call, creates the missed-call
// notification when due, and emits new_message + call_ended. Shared by
// finalizeCall and the busy path.
async function announceResolution(call) {
  const message = await Message.create({
    conversationId: call.conversationId,
    senderId: call.callerId,
    content: systemText(call),
    messageType: 'call',
    callRef: call._id,
    readBy: [],
    deliveredTo: [],
  });
  call.messageId = message._id;
  await call.save();

  await Conversation.findByIdAndUpdate(call.conversationId, {
    lastMessage: message._id,
    updatedAt: new Date(),
  });
  // A call is activity: bring the conversation back for anyone who archived.
  await ConversationMember.updateMany(
    { conversationId: call.conversationId, archived: true },
    { $set: { archived: false } }
  );

  if (call.status === 'missed') {
    const calleeMembership = await ConversationMember.findOne({
      conversationId: call.conversationId,
      userId: call.calleeId,
    });
    if (!calleeMembership || !calleeMembership.muted) {
      await Notification.create({
        recipientId: call.calleeId,
        senderId: call.callerId,
        type: 'missed_call',
        conversationId: call.conversationId,
        messageId: message._id,
      });
    }
  }

  if (ioRef) {
    const populated = await populateMessage(Message.findById(message._id));
    ioRef.to(`conv:${call.conversationId}`).emit('new_message', { message: populated });
    const payload = {
      callId: call._id.toString(),
      conversationId: call.conversationId.toString(),
      status: call.status,
      reason: call.endReason,
      durationSec: call.durationSec,
    };
    ioRef.to(`user:${call.callerId}`).emit('call_ended', payload);
    ioRef.to(`user:${call.calleeId}`).emit('call_ended', payload);
  }
  return message;
}

// Resolves a call to a final status exactly once. Writes the system message
// (+ missed-call notification) and notifies both parties and the
// conversation room. Returns { call, message } or null when already final.
async function finalizeCall(callId, status, reason = '') {
  const slot = activeById.get(callId.toString());
  if (!slot) return null; // already finalized (or never active here)
  clearTimeout(slot.ringTimer);
  activeById.delete(callId.toString());

  const call = await getCall(callId);
  if (!call) return null;
  activeByUser.delete(call.callerId.toString());
  activeByUser.delete(call.calleeId.toString());

  call.status = status;
  call.endReason = reason;
  call.endedAt = new Date();
  call.durationSec = call.answeredAt
    ? Math.max(0, Math.round((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000))
    : 0;

  const message = await announceResolution(call);
  return { call, message };
}

// The callee is already in another call: the attempt never rings, but it is
// still logged (declined / busy) and surfaced in the conversation.
async function recordBusyCall({ callerId, calleeId, conversationId, type }) {
  const call = await Call.create({
    callerId,
    calleeId,
    conversationId,
    type,
    status: 'declined',
    endReason: 'busy',
    endedAt: new Date(),
    durationSec: 0,
  });
  const message = await announceResolution(call);
  return { call, message };
}

// A socket went away: resolve any active call it belonged to.
async function endCallsForUser(userId) {
  const callId = activeCallIdForUser(userId);
  if (!callId) return;
  const call = await getCall(callId);
  if (!call) return;
  if (call.status === 'ongoing') {
    await finalizeCall(callId, 'completed', 'disconnect');
  } else {
    await finalizeCall(callId, 'missed', 'disconnect');
  }
}

function serializeCall(call, viewerId) {
  const obj = call.toObject ? call.toObject() : { ...call };
  // callerId may be populated (a document) or a bare ObjectId — normalize
  // to the raw id before comparing.
  const callerRaw =
    call.callerId && call.callerId._id ? call.callerId._id : call.callerId;
  obj.direction =
    callerRaw && callerRaw.toString() === viewerId.toString() ? 'outgoing' : 'incoming';
  return obj;
}

module.exports = {
  RING_TIMEOUT_MS,
  init,
  startCall,
  markAnswered,
  finalizeCall,
  recordBusyCall,
  endCallsForUser,
  getCall,
  isParty,
  otherParty,
  activeCallIdForUser,
  serializeCall,
  formatDuration,
};
