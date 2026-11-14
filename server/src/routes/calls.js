const express = require('express');
const Call = require('../models/Call');
const { requireAuth } = require('../middleware/auth');
const { serializeCall } = require('../services/callService');

const router = express.Router();
router.use(requireAuth);

// Call history (module 8): every call the caller took part in, newest
// first, with direction relative to the viewer. Signalling itself happens
// over Socket.IO — this endpoint is only the log.
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const calls = await Call.find({
      $or: [{ callerId: req.user._id }, { calleeId: req.user._id }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('callerId', 'username profilePicture')
      .populate('calleeId', 'username profilePicture');
    return res.json({ calls: calls.map((c) => serializeCall(c, req.user._id)) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
