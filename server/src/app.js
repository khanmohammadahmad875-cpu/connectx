const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const compression = require('compression');

const { UPLOAD_DIR } = require('./middleware/upload');

const app = express();

// --- Security + parsing ------------------------------------------------------
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
// Gzip everything (API JSON + the client bundle): the ~700 KB app JS
// drops to roughly a quarter of its size on the wire, which is the
// single biggest loading-speed win on mobile data.
app.use(compression());

// General API rate limiting (auth routes have their own stricter limiter).
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- Static uploads (local storage mode) -------------------------------------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// --- Routes ------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  res.json({
    status: 'ok',
    service: 'ConnectX API',
    database: dbState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/status', require('./routes/status'));
app.use('/api/reels', require('./routes/reels'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/prayer-times', require('./routes/prayerTimes'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/chat-locks', require('./routes/chatLocks'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/live-location', require('./routes/liveLocation'));
app.use('/api/business', require('./routes/business'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/communities', require('./routes/communities'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/events', require('./routes/events'));
app.use('/api/docs', require('./routes/docs'));
app.use('/api/security', require('./routes/security'));

// In production the server can also serve the built React client (single deploy).
if (process.env.SERVE_CLIENT === 'true') {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  // Vite asset filenames are content-hashed, so they can be cached
  // forever; index.html itself must always be revalidated so a new
  // deploy shows up on the next open instead of a stale cached shell.
  app.use(
    express.static(clientDist, {
      maxAge: '30d',
      immutable: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Central error handler
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'File is too large (max 10 MB)' });
  }
  console.error('[error]', err);
  return res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

module.exports = app;
