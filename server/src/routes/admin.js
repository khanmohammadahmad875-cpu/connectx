const express = require('express');
const { z } = require('zod');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Report = require('../models/Report');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/stats', async (req, res, next) => {
  try {
    const [users, conversations, messages, pendingReports] = await Promise.all([
      User.countDocuments(),
      Conversation.countDocuments(),
      Message.countDocuments({ deletedAt: null }),
      Report.countDocuments({ status: 'pending' }),
    ]);
    return res.json({ stats: { users, conversations, messages, pendingReports } });
  } catch (err) {
    return next(err);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(200);
    return res.json({ users: users.map((u) => u.toSafeJSON()) });
  } catch (err) {
    return next(err);
  }
});

router.patch('/users/:id/suspend', validate(z.object({ suspend: z.boolean() })), async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ message: 'Admins cannot be suspended' });
    user.isBlocked = req.body.suspend;
    await user.save();
    return res.json({ user: user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
});

// Business verification (module 30): the ONLY way the verified badge is
// set. Owners cannot self-verify — the owner-facing business schema does
// not even accept the field.
router.patch(
  '/users/:id/business-verified',
  validate(z.object({ verified: z.boolean() })),
  async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
      if (!user.business) user.business = {};
      user.business.verified = req.body.verified;
      await user.save();
      return res.json({ user: user.toSafeJSON() });
    } catch (err) {
      return next(err);
    }
  }
);

router.get('/reports', async (req, res, next) => {
  try {
    const reports = await Report.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('reportedBy', 'username')
      .populate('reportedUser', 'username')
      .populate('messageId', 'content');
    return res.json({ reports });
  } catch (err) {
    return next(err);
  }
});

router.patch('/reports/:id', validate(z.object({ status: z.enum(['reviewed', 'dismissed', 'pending']) })), async (req, res, next) => {
  try {
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    if (!report) return res.status(404).json({ message: 'Report not found' });
    return res.json({ report });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
