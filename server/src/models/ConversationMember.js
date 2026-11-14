const mongoose = require('mongoose');

// Per-user membership: group permissions + per-user read state live here,
// not inside the conversation document.
const conversationMemberSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    lastReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    muted: { type: Boolean, default: false },
    // Archive (Module 20): visibility-only for this user. A new incoming
    // message clears it automatically (auto-unarchive).
    archived: { type: Boolean, default: false },
    // Chat lock (Module 19): locked for this user; history and sends are
    // refused server-side without a short-lived unlock grant.
    locked: { type: Boolean, default: false },
    // Hidden chats (Module 21): a locked chat that also disappears from the
    // locked list until the user enters their secret code.
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

conversationMemberSchema.index({ conversationId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ConversationMember', conversationMemberSchema);
