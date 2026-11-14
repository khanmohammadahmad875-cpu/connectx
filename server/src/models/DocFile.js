const mongoose = require('mongoose');

// A file registered inside a shared folder (module 32). The bytes live in
// the existing uploads pipeline (local disk or Cloudinary); this document
// holds the metadata and is what access control hangs off. Downloads go
// through GET /api/docs/files/:id/download, which checks folder access
// before handing out the file.
const docFileSchema = new mongoose.Schema(
  {
    folder: { type: mongoose.Schema.Types.ObjectId, ref: 'DocFolder', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    url: { type: String, required: true, maxlength: 2000 },
    size: { type: Number, default: 0 },
    mimeType: { type: String, default: '', maxlength: 120 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DocFile', docFileSchema);
