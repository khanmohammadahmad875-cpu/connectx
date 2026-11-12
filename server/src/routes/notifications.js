const express = require('express');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const notifications = await Notification.find({ recipientId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('senderId', 'username profilePicture')
      .populate('messageId', 'content messageType');
    const unreadCount = await Notification.countDocuments({
      recipientId: req.user._id,
      isRead: false,
    });
    return res.json({ notifications, unreadCount });
  } catch (err) {
    return next(err);
  }
});

router.patch('/read', async (req, res, next) => {
  try {
    const filter = { recipientId: req.user._id, isRead: false };
    if (req.body && req.body.conversationId) filter.conversationId = req.body.conversationId;
    await Notification.updateMany(filter, { isRead: true });
    return res.json({ message: 'Notifications marked as read' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
