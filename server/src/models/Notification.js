const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['message', 'missed_call', 'event_reminder', 'security'],
      default: 'message',
    },
    // Conversation/message notifications carry both refs; event reminders
    // and security notices are not tied to a conversation, so both refs are
    // optional and `text` carries the human-readable message instead.
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
    text: { type: String, default: '', maxlength: 500 },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
