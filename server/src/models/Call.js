const mongoose = require('mongoose');

// Persisted call log entry (SRS v2.0 module 8 — 1-to-1 voice/video calls).
// A record is created when the ring starts and resolved to a final status
// when the call is answered/ended, declined, missed (timeout / caller
// cancelled / disconnect) or completed. `endReason` keeps the detail the
// coarse status loses: 'rejected' | 'busy' | 'timeout' | 'cancelled' |
// 'disconnect' | 'ended'.
const callSchema = new mongoose.Schema(
  {
    callerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    calleeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    type: { type: String, enum: ['voice', 'video'], required: true },
    status: {
      type: String,
      enum: ['ringing', 'ongoing', 'completed', 'missed', 'declined'],
      default: 'ringing',
    },
    endReason: { type: String, default: '' },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSec: { type: Number, default: 0 },
    // The system message in the conversation that surfaces this call in the
    // chat history (set when the call resolves).
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  },
  { timestamps: true }
);

callSchema.index({ callerId: 1, createdAt: -1 });
callSchema.index({ calleeId: 1, createdAt: -1 });

module.exports = mongoose.model('Call', callSchema);
