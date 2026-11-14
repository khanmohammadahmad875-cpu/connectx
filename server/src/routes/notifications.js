const express = require('express');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const { lockedConversationIds } = require('../services/lockService');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    // Chat lock (Module 19): notifications belonging to conversations this
    // user locked are withheld entirely — sender, preview and count — so a
    // locked chat can never leak through the notification payload.
    const lockedIds = await lockedConversationIds(req.user._id);
    const filter = {
      recipientId: req.user._id,
      conversationId: { $nin: lockedIds },
    };
    const found = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('senderId', 'username profilePicture')
      .populate('messageId', 'content messageType');
    // Settings → Notifications: users who turned message previews off get
    // the notification without the message text (sender + type only).
    const showPreviews = req.user.preferences?.notificationPreviews !== false;
    const notifications = found.map((n) => {
      const obj = n.toObject();
      if (!showPreviews && obj.type === 'message' && obj.messageId) {
        obj.messageId = { ...obj.messageId, content: '' };
      }
      return obj;
    });
    const unreadCount = await Notification.countDocuments({
      ...filter,
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
