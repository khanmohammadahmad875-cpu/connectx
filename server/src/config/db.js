const mongoose = require('mongoose');

let memoryServer = null;

/**
 * Connect to MongoDB.
 *
 * Two modes:
 *  - USE_MEMORY_DB=true  -> spins up an in-memory MongoDB (mongodb-memory-server).
 *    Zero setup for local development and demos. Data is lost when the server stops.
 *  - USE_MEMORY_DB=false -> connects to MONGODB_URI (local MongoDB or MongoDB Atlas).
 *    Use this for real, persistent data.
 */
async function connectDB() {
  let uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectx';

  if (process.env.USE_MEMORY_DB === 'true') {
    // Required lazily so production installs don't need the dev dependency at runtime.
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri('connectx');
    console.log('[db] Using in-memory MongoDB (development mode)');
  }

  await mongoose.connect(uri);
  console.log(`[db] MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

module.exports = { connectDB, disconnectDB };
