const mongoose = require('mongoose');

// A live-location sharing session (v3.0 module 29). The sharer picks a
// duration (15 min / 1 h / 8 h); the latest position is kept here and the
// rendering message carries a snapshot plus this session's id. A session is
// active while it has no stoppedAt and its expiresAt is still in the future
// — expiry is enforced lazily on every read/update, so no sweeper is needed.
const liveLocationSessionSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    label: { type: String, default: '', maxlength: 120 },
    durationSec: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    stoppedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

liveLocationSessionSchema.methods.isActive = function isActive(now = new Date()) {
  return !this.stoppedAt && this.expiresAt.getTime() > now.getTime();
};

module.exports = mongoose.model('LiveLocationSession', liveLocationSessionSchema);
