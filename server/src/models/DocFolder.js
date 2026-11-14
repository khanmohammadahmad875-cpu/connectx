const mongoose = require('mongoose');

// Shared folders (module 32). A folder has one owner; it can be shared with
// specific users and/or with all members of a conversation. Everyone with
// access (owner or shared) can read and add/edit content inside; only the
// owner can rename, delete or change the sharing. Access is enforced
// server-side on every read/download — see routes/docs.js.
const docFolderSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'DocFolder', default: null },
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    sharedConversations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('DocFolder', docFolderSchema);
