const mongoose = require('mongoose');
const { REEL_INTERESTS } = require('../utils/interests');

// Reel: a short vertical video (TikTok-style feed). The video file itself
// goes through the existing uploads pipeline (video kind, same size caps);
// a reel is just the metadata + engagement counters around that URL.
const reelSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    videoUrl: { type: String, required: true, maxlength: 2000 },
    caption: { type: String, default: '', maxlength: 500 },
    // One tag from the shared interest list — validated again in the routes.
    interest: { type: String, enum: REEL_INTERESTS, required: true },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Feed ordering is newest-first inside each interest tier.
reelSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Reel', reelSchema);
