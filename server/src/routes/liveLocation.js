const express = require('express');
const { z } = require('zod');
const LiveLocationSession = require('../models/LiveLocationSession');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireMembership } = require('../services/messageService');
const {
  startLiveLocation,
  updateLiveLocation,
  stopLiveLocation,
  serializeSession,
} = require('../services/liveLocationService');
const { assertConversationUnlocked, requestUnlocked } = require('../services/lockService');

const router = express.Router();
router.use(requireAuth);

function emitToConversation(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.to(`conv:${payload.conversationId}`).emit(event, payload);
}

const startSchema = z.object({
  conversationId: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  label: z.string().max(120).optional().default(''),
  // The client offers 900 (15 min), 3600 (1 h) and 28800 (8 h); the range
  // is validated here, the choices are a UI concern.
  durationSec: z.number().int().min(1).max(28800),
});

// Start sharing: creates the session + its rendering message and broadcasts
// the message exactly like a normal send.
router.post('/start', validate(startSchema), async (req, res, next) => {
  try {
    const { session, message } = await startLiveLocation({
      conversationId: req.body.conversationId,
      userId: req.user._id,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      label: req.body.label,
      durationSec: req.body.durationSec,
      unlocked: requestUnlocked(req),
    });
    const io = req.app.get('io');
    if (io) io.to(`conv:${req.body.conversationId}`).emit('new_message', { message });
    return res.status(201).json({ session: serializeSession(session), message });
  } catch (err) {
    return next(err);
  }
});

const positionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// Position update (the socket event of the same name shares this service).
router.post('/:id/update', validate(positionSchema), async (req, res, next) => {
  try {
    const session = await updateLiveLocation({
      sessionId: req.params.id,
      userId: req.user._id,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
    });
    emitToConversation(req, 'live_location_update', {
      sessionId: session._id.toString(),
      conversationId: session.conversationId.toString(),
      messageId: session.messageId ? session.messageId.toString() : null,
      latitude: session.latitude,
      longitude: session.longitude,
      expiresAt: session.expiresAt,
      stoppedAt: null,
    });
    return res.json({ session: serializeSession(session) });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/stop', async (req, res, next) => {
  try {
    const session = await stopLiveLocation({
      sessionId: req.params.id,
      userId: req.user._id,
    });
    emitToConversation(req, 'live_location_update', {
      sessionId: session._id.toString(),
      conversationId: session.conversationId.toString(),
      messageId: session.messageId ? session.messageId.toString() : null,
      latitude: session.latitude,
      longitude: session.longitude,
      expiresAt: session.expiresAt,
      stoppedAt: session.stoppedAt,
    });
    return res.json({ session: serializeSession(session) });
  } catch (err) {
    return next(err);
  }
});

// Current state of a session — members of the conversation only.
router.get('/:id', async (req, res, next) => {
  try {
    const session = await LiveLocationSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Live location session not found' });
    await requireMembership(session.conversationId, req.user._id);
    await assertConversationUnlocked(session.conversationId, req.user._id, requestUnlocked(req));
    return res.json({ session: serializeSession(session) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
