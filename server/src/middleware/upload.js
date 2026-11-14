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

// Extension → kind fallback. Phone galleries / WebView file pickers do not
// always report a usable MIME type: valid photos and videos can arrive as
// application/octet-stream (or with no type at all). For those, and ONLY
// those, the kind is inferred from the file extension. A declared MIME type
// that is not on the allow-list is still rejected exactly as before.
const EXT_KIND = new Map([
  ['.jpg', 'image'],
  ['.jpeg', 'image'],
  ['.png', 'image'],
  ['.gif', 'image'],
  ['.webp', 'image'],
  ['.mp4', 'video'],
  ['.webm', 'video'],
  ['.mov', 'video'],
  ['.pdf', 'file'],
  ['.txt', 'file'],
  ['.doc', 'file'],
  ['.docx', 'file'],
  ['.mp3', 'audio'],
  ['.ogg', 'audio'],
  ['.wav', 'audio'],
  ['.m4a', 'audio'],
  ['.aac', 'audio'],
]);

// HEIC/HEIF (the default iPhone/Android high-efficiency photo format) cannot
// be decoded by browsers/WebView at all, so it gets its own clear error
// instead of a generic "unsupported type" failure.
const HEIC_MESSAGE =
  'HEIC photos are not supported — please pick a JPG or PNG photo instead.';

function isHeic(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  return ext === '.heic' || ext === '.heif' || mime === 'image/heic' || mime === 'image/heif';
}

// The kind ('image' | 'video' | 'audio' | 'file') of an upload: by declared
// MIME type first, then — only when the type is missing/generic — by
// extension. Used by the filter and by the route's per-kind size cap.
function kindForFile(file) {
  if (ALLOWED.has(file.mimetype)) return ALLOWED.get(file.mimetype);
  const ext = path.extname(file.originalname || '').toLowerCase();
  return EXT_KIND.get(ext) || 'file';
}

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
    if (isHeic(file)) {
      const err = new Error(HEIC_MESSAGE);
      err.status = 400;
      return cb(err);
    }
    // No usable declared type (missing/empty/application/octet-stream, as
    // phone pickers often send): accept only if the extension names a kind
    // we allow; kindForFile() then classifies it for the route.
    const mime = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    if ((!mime || mime === 'application/octet-stream') && EXT_KIND.has(ext)) {
      return cb(null, true);
    }
    const err = new Error(`Unsupported file type: ${file.mimetype}`);
    err.status = 400;
    return cb(err);
  },
});

module.exports = { upload, ALLOWED, UPLOAD_DIR, FILE_MAX_BYTES, VIDEO_MAX_BYTES, kindForFile };
