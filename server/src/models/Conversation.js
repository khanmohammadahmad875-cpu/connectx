const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['private', 'group', 'channel'], required: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    groupName: { type: String, default: '' },
    groupImage: { type: String, default: '' },
    // Channel fields (Module 14): only meaningful when type === 'channel'.
    // A channel is a broadcast conversation: admins post, members follow.
    description: { type: String, default: '', maxlength: 500 },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    // Disappearing messages: when > 0, messages created in this conversation
    // get an expiresAt that many seconds after they are sent. 0 = off.
    // Product options are Off / 24h (86400) / 7d (604800).
    disappearingDurationSec: { type: Number, default: 0 },
    // For private chats: "userIdA:userIdB" (sorted) with a unique index, so the
    // same pair of users can never get two private conversations.
    pairKey: { type: String, default: null },
  },
  { timestamps: true }
);

conversationSchema.index({ pairKey: 1 }, { unique: true, sparse: true });
conversationSchema.index({ participants: 1, updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
