const express = require('express');
const { z } = require('zod');
const Report = require('../models/Report');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

// Anti-spam auto-flag (module 24): when an account accumulates at least
// REPORT_FLAG_THRESHOLD reports from DISTINCT reporters inside
// REPORT_FLAG_WINDOW_MS, it is flagged for admin review. Flagging is all
// that happens automatically — admins decide on any further action.
const REPORT_FLAG_THRESHOLD = () => Number(process.env.REPORT_FLAG_THRESHOLD || 3);
const REPORT_FLAG_WINDOW_MS = () => Number(process.env.REPORT_FLAG_WINDOW_MS || 7 * 24 * 60 * 60 * 1000);

async function maybeAutoFlag(reportedUserId) {
  const since = new Date(Date.now() - REPORT_FLAG_WINDOW_MS());
  const reports = await Report.find({
    reportedUser: reportedUserId,
    createdAt: { $gte: since },
  }).select('reportedBy');
  const distinctReporters = new Set(reports.map((r) => r.reportedBy.toString()));
  if (distinctReporters.size < REPORT_FLAG_THRESHOLD()) return;
  const target = await User.findById(reportedUserId);
  if (target && !target.spamFlagged) {
    target.spamFlagged = true;
    target.spamFlagReason = `Auto-flagged: ${distinctReporters.size} reports from different users within ${Math.round(
      REPORT_FLAG_WINDOW_MS() / (24 * 60 * 60 * 1000)
    )} days`;
    target.spamFlaggedAt = new Date();
    await target.save();
  }
}

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
      await maybeAutoFlag(target._id);
      return res.status(201).json({ report });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
