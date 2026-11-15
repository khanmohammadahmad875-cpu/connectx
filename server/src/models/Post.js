const mongoose = require('mongoose');

// Post: a Facebook-style feed entry — text and/or a photo, visible to
// every signed-in user. The photo file itself goes through the existing
// uploads pipeline (image kind, same caps as chat photos); a post is the
// text + engagement (likes, comments) around it.
const commentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 500 },
  },
  { timestamps: true }
);

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, default: '', maxlength: 2000 },
    imageUrl: { type: String, default: '', maxlength: 2000 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [commentSchema],
  },
  { timestamps: true }
);

// The feed is newest-first.
postSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);
