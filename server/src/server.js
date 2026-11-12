require('dotenv').config();

const http = require('http');
const app = require('./app');
const { connectDB, disconnectDB } = require('./config/db');
const { initSocket } = require('./socket');
const User = require('./models/User');

const PORT = process.env.PORT || 5000;

async function promoteConfiguredAdmin() {
  if (!process.env.ADMIN_EMAIL) return;
  const admin = await User.findOne({ email: process.env.ADMIN_EMAIL.toLowerCase() });
  if (admin && admin.role !== 'admin') {
    admin.role = 'admin';
    await admin.save();
    console.log(`[server] Promoted ${admin.email} to admin (ADMIN_EMAIL)`);
  }
}

async function start() {
  await connectDB();
  await promoteConfiguredAdmin();

  const httpServer = http.createServer(app);
  const io = initSocket(httpServer, process.env.CLIENT_URL || 'http://localhost:5173');
  app.set('io', io);

  httpServer.listen(PORT, () => {
    console.log(`[server] ConnectX API running on http://localhost:${PORT}`);
    console.log('[server] Socket.IO ready');
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} received, shutting down...`);
    io.close();
    httpServer.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[server] Failed to start:', err.message);
  process.exit(1);
});
