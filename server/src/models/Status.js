const mongoose = require('mongoose');

const statusViewerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    viewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// WhatsApp-style status (story): an image or a text card with a background
// color, visible for 24 hours to users who share a conversation with the
// author. A TTL index on expiresAt removes expired statuses automatically.
const statusSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['image', 'text'], required: true },
    mediaUrl: { type: String, default: '' }, // for type "image" (uploads pipeline)
    text: { type: String, default: '', maxlength: 700 }, // for type "text"
    backgroundColor: { type: String, default: '#2f7bff', maxlength: 32 }, // text card bg
    viewers: { type: [statusViewerSchema], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL: MongoDB deletes the document once expiresAt passes.
statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
statusSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Status', statusSchema);
