const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Allowed: images, common documents, voice-message audio (Module 5) and
// chat/status videos. Anything else is rejected (400). Browsers record
// voice notes as webm/ogg/mp4 depending on the platform, so all common
// audio types pass. Video containers: mp4, webm and QuickTime (mov).
const ALLOWED = new Map([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/gif', 'image'],
  ['image/webp', 'image'],
  ['application/pdf', 'file'],
  ['text/plain', 'file'],
  ['application/msword', 'file'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'file'],
  ['audio/webm', 'audio'],
  ['audio/ogg', 'audio'],
  ['audio/mpeg', 'audio'],
  ['audio/mp3', 'audio'],
  ['audio/mp4', 'audio'],
  ['audio/aac', 'audio'],
  ['audio/wav', 'audio'],
  ['audio/x-wav', 'audio'],
  ['video/mp4', 'video'],
  ['video/webm', 'video'],
  ['video/quicktime', 'video'],
]);

// Size caps: 10 MB for everything except video, which gets 64 MB (chat and
// status clips are short phone recordings). Multer enforces the overall
// ceiling; the upload route enforces the per-kind cap after the fact.
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 64 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: VIDEO_MAX_BYTES }, // overall ceiling = the video cap
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    const err = new Error(`Unsupported file type: ${file.mimetype}`);
    err.status = 400;
    return cb(err);
  },
});

module.exports = { upload, ALLOWED, UPLOAD_DIR, FILE_MAX_BYTES, VIDEO_MAX_BYTES };
