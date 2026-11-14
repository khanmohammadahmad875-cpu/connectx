const express = require('express');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { upload, ALLOWED, FILE_MAX_BYTES } = require('../middleware/upload');

const router = express.Router();

// Uploads a single file (field name: "file").
// - If Cloudinary credentials are configured in .env, the file is stored there.
// - Otherwise it is stored locally under server/uploads and served at /uploads/...
router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file received' });
    const kind = ALLOWED.get(req.file.mimetype) || 'file';
    // Per-kind size cap: only video may exceed the standard 10 MB limit
    // (video itself is capped at 64 MB by multer's ceiling).
    if (kind !== 'video' && req.file.size > FILE_MAX_BYTES) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: 'File is too large (10 MB limit)' });
    }

    const cloudConfigured =
      process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;

    if (cloudConfigured) {
      const cloudinary = require('cloudinary').v2;
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      const result = await cloudinary.uploader.upload(req.file.path, {
        resource_type: 'auto',
        folder: 'connectx',
      });
      fs.unlink(req.file.path, () => {});
      return res.status(201).json({
        url: result.secure_url,
        messageType: kind,
        originalName: req.file.originalname,
      });
    }

    const base = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    return res.status(201).json({
      url: `${base}/uploads/${req.file.filename}`,
      messageType: kind,
      originalName: req.file.originalname,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
