const mongoose = require('mongoose');

// A task list (module 32): standalone or inside a shared folder (in which
// case the folder's sharing also grants access). Otherwise access follows
// the same rule as folders: owner + sharedWith users + members of
// sharedConversations.
const taskListSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    folder: { type: mongoose.Schema.Types.ObjectId, ref: 'DocFolder', default: null },
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    sharedConversations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('TaskList', taskListSchema);
