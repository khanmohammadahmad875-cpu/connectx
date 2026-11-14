const mongoose = require('mongoose');

// A community (Module 14) groups several existing group conversations under
// one name/avatar. It owns one announcement channel (a broadcast
// Conversation) where community admins post; members are derived from the
// linked groups rather than stored separately.
const communitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 500 },
    avatar: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    groupIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' }],
    announcementChannelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Community', communitySchema);
