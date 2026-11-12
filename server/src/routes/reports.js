const express = require('express');
const { z } = require('zod');
const Report = require('../models/Report');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/',
  validate(
    z.object({
      reportedUser: z.string(),
      messageId: z.string().nullable().optional(),
      reason: z.string().trim().min(3).max(500),
    })
  ),
  async (req, res, next) => {
    try {
      const target = await User.findById(req.body.reportedUser);
      if (!target) return res.status(404).json({ message: 'Reported user not found' });
      if (target._id.toString() === req.user._id.toString()) {
        return res.status(400).json({ message: 'You cannot report yourself' });
      }
      const report = await Report.create({
        reportedBy: req.user._id,
        reportedUser: target._id,
        messageId: req.body.messageId || null,
        reason: req.body.reason,
      });
      return res.status(201).json({ report });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
