const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['private', 'group'], required: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    groupName: { type: String, default: '' },
    groupImage: { type: String, default: '' },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    // For private chats: "userIdA:userIdB" (sorted) with a unique index, so the
    // same pair of users can never get two private conversations.
    pairKey: { type: String, default: null },
  },
  { timestamps: true }
);

conversationSchema.index({ pairKey: 1 }, { unique: true, sparse: true });
conversationSchema.index({ participants: 1, updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
