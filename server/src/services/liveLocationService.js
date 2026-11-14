// Live-location sessions (v3.0 module 29), shared by the REST routes and the
// Socket.IO update event so both enforce identical rules:
//  - only the sharer may update or stop a session;
//  - updates are refused once the session stopped or expired (lazy expiry —
//    an expired session is marked stopped the first time it is touched);
//  - the rendering message's snapshot is kept in sync with the session.
const LiveLocationSession = require('../models/LiveLocationSession');
const Message = require('../models/Message');
const { createMessage, requireMembership } = require('./messageService');
const { assertConversationUnlocked } = require('./lockService');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validCoords(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function serializeSession(session) {
  return {
    _id: session._id,
    conversationId: session.conversationId,
    userId: session.userId,
    messageId: session.messageId,
    latitude: session.latitude,
    longitude: session.longitude,
    label: session.label,
    durationSec: session.durationSec,
    expiresAt: session.expiresAt,
    stoppedAt: session.stoppedAt,
    active: session.isActive(),
    createdAt: session.createdAt,
  };
}

// Starts a session and posts its rendering message into the conversation.
// Chat-lock rules apply exactly as for any other message send.
async function startLiveLocation({
  conversationId,
  userId,
  latitude,
  longitude,
  label = '',
  durationSec,
  unlocked = false,
}) {
  if (!validCoords(latitude, longitude)) {
    throw httpError(400, 'Invalid coordinates');
  }
  const secs = Number(durationSec);
  if (!Number.isFinite(secs) || secs < 1 || secs > 8 * 3600) {
    throw httpError(400, 'durationSec must be between 1 and 28800');
  }
  await requireMembership(conversationId, userId);
  await assertConversationUnlocked(conversationId, userId, unlocked);

  const expiresAt = new Date(Date.now() + secs * 1000);
  const session = await LiveLocationSession.create({
    conversationId,
    userId,
    latitude,
    longitude,
    label: String(label || '').slice(0, 120),
    durationSec: secs,
    expiresAt,
  });

  const { message } = await createMessage({
    conversationId,
    senderId: userId,
    content: '',
    messageType: 'live_location',
    liveLocation: {
      sessionId: session._id,
      latitude,
      longitude,
      label: session.label,
      expiresAt,
    },
    unlocked,
  });
  session.messageId = message._id;
  await session.save();
  return { session, message };
}

async function loadOwnedActiveSession(sessionId, userId) {
  const session = await LiveLocationSession.findById(sessionId);
  if (!session) throw httpError(404, 'Live location session not found');
  if (session.userId.toString() !== userId.toString()) {
    throw httpError(403, 'Only the sharer can update this live location');
  }
  if (session.stoppedAt) throw httpError(400, 'This live location has been stopped');
  if (!session.isActive()) {
    session.stoppedAt = new Date();
    await session.save();
    await syncMessageSnapshot(session);
    throw httpError(400, 'This live location session has expired');
  }
  return session;
}

async function syncMessageSnapshot(session) {
  if (!session.messageId) return;
  await Message.findByIdAndUpdate(session.messageId, {
    'liveLocation.latitude': session.latitude,
    'liveLocation.longitude': session.longitude,
    'liveLocation.expiresAt': session.expiresAt,
    'liveLocation.stoppedAt': session.stoppedAt || null,
  });
}

async function updateLiveLocation({ sessionId, userId, latitude, longitude }) {
  if (!validCoords(latitude, longitude)) {
    throw httpError(400, 'Invalid coordinates');
  }
  const session = await loadOwnedActiveSession(sessionId, userId);
  session.latitude = latitude;
  session.longitude = longitude;
  await session.save();
  await syncMessageSnapshot(session);
  return session;
}

async function stopLiveLocation({ sessionId, userId }) {
  const session = await LiveLocationSession.findById(sessionId);
  if (!session) throw httpError(404, 'Live location session not found');
  if (session.userId.toString() !== userId.toString()) {
    throw httpError(403, 'Only the sharer can stop this live location');
  }
  if (!session.stoppedAt) {
    session.stoppedAt = new Date();
    await session.save();
    await syncMessageSnapshot(session);
  }
  return session;
}

module.exports = {
  startLiveLocation,
  updateLiveLocation,
  stopLiveLocation,
  serializeSession,
  validCoords,
};
