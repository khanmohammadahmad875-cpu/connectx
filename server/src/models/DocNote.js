const mongoose = require('mongoose');

// A simple shared text note inside a folder (module 32). Anyone with folder
// access may create and edit notes (the folder's sharing defines the
// editors); only the note's author or the folder owner can delete one.
const docNoteSchema = new mongoose.Schema(
  {
    folder: { type: mongoose.Schema.Types.ObjectId, ref: 'DocFolder', required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, default: '', maxlength: 20000 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DocNote', docNoteSchema);
