/**
 * ConnectX end-to-end test suite.
 * Boots the real server (in-memory MongoDB) on a test port and runs the
 * acceptance scenarios from the project spec (SRS section 8) plus extras.
 *
 * Run:  node tests/e2e.cjs
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 5055;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function req(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token }, reconnection: false });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
    setTimeout(() => reject(new Error('socket connect timeout')), 8000);
  });
}

function waitEvent(socket, event, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(6000).emit(event, payload, (err, ack) => {
      if (err) reject(err);
      else resolve(ack);
    });
  });
}

async function waitForHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch (err) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Server did not become healthy in time');
}

// Stub Open-Meteo provider so the weather checks never touch the network.
function makeWeatherStub() {
  return http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/geo')) {
      res.end(
        JSON.stringify({
          results: [
            { name: 'Test City', country: 'Testland', latitude: 33.6, longitude: 73.1, timezone: 'Asia/Karachi' },
          ],
        })
      );
      return;
    }
    if (u.pathname.startsWith('/forecast')) {
      const now = new Date();
      now.setMinutes(0, 0, 0);
      const isoHour = (d) => d.toISOString().slice(0, 13) + ':00';
      const hourlyTimes = [];
      const hourlyTemps = [];
      for (let i = 0; i < 48; i++) {
        const d = new Date(now.getTime() + i * 3600e3);
        hourlyTimes.push(isoHour(d));
        hourlyTemps.push(20 + (i % 8));
      }
      const dailyTimes = [];
      for (let i = 0; i < 7; i++) {
        dailyTimes.push(new Date(now.getTime() + i * 86400e3).toISOString().slice(0, 10));
      }
      res.end(
        JSON.stringify({
          timezone: 'Asia/Karachi',
          current: {
            time: isoHour(now),
            temperature_2m: 24.5,
            relative_humidity_2m: 41,
            apparent_temperature: 25.1,
            weather_code: 1,
            wind_speed_10m: 9.4,
          },
          hourly: {
            time: hourlyTimes,
            temperature_2m: hourlyTemps,
            weather_code: hourlyTimes.map(() => 1),
          },
          daily: {
            time: dailyTimes,
            temperature_2m_max: dailyTimes.map(() => 30),
            temperature_2m_min: dailyTimes.map(() => 18),
            weather_code: dailyTimes.map(() => 2),
          },
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
}

// Stub Aladhan provider so the prayer-times checks never touch the network.
let lastPrayerQuery = '';
function makePrayerStub() {
  return http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/timings/')) {
      lastPrayerQuery = u.search;
      const school = u.searchParams.get('school');
      res.end(
        JSON.stringify({
          code: 200,
          data: {
            timings: {
              Fajr: '05:19', Sunrise: '06:45', Dhuhr: '11:58',
              Asr: school === '0' ? '14:51' : '15:33',
              Sunset: '17:11', Maghrib: '17:11', Isha: '18:37',
            },
            date: {
              readable: '14 Nov 2026',
              hijri: { day: '4', month: { en: 'Jumada al-awwal' }, year: '1448', weekday: { en: 'Al Sabt' } },
            },
            meta: { timezone: 'Asia/Karachi', method: { name: 'University of Islamic Sciences, Karachi' } },
          },
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
}

async function main() {
  const weatherStub = makeWeatherStub();
  await new Promise((resolve) => weatherStub.listen(5077, resolve));
  const prayerStub = makePrayerStub();
  await new Promise((resolve) => prayerStub.listen(5078, resolve));
  console.log('[test] Starting ConnectX server on port', PORT, '...');
  const server = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      USE_MEMORY_DB: 'true',
      CLIENT_URL: 'http://localhost:5173',
      PUBLIC_BASE_URL: BASE,
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      ADMIN_EMAIL: 'admin@connectx.test',
      CALL_RING_TIMEOUT_MS: '1500',
      EVENT_REMINDER_INTERVAL_MS: '300',
      OPEN_METEO_GEO_URL: 'http://localhost:5077/geo',
      OPEN_METEO_API_URL: 'http://localhost:5077/forecast',
      ALADHAN_URL: 'http://localhost:5078',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  try {
    await waitForHealth();
    console.log('[test] Server is up. Running scenarios...\n');

    // --- Health -------------------------------------------------------------
    const health = await req('GET', '/api/health');
    check('Health endpoint reports ok + DB connected',
      health.status === 200 && health.data.status === 'ok' && health.data.database === 'connected');

    // --- Registration ---------------------------------------------------------
    const regA = await req('POST', '/api/auth/register', {
      body: { username: 'ahmad', email: 'ahmad@test.dev', password: 'Password1!' },
    });
    check('Register user A', regA.status === 201 && !!regA.data.accessToken);
    const A = { token: regA.data.accessToken, id: regA.data.user._id };

    const regB = await req('POST', '/api/auth/register', {
      body: { username: 'bilal', email: 'bilal@test.dev', password: 'Password1!' },
    });
    const B = { token: regB.data.accessToken, id: regB.data.user._id };
    check('Register user B', regB.status === 201);

    const regC = await req('POST', '/api/auth/register', {
      body: { username: 'charlie', email: 'charlie@test.dev', password: 'Password1!' },
    });
    const C = { token: regC.data.accessToken, id: regC.data.user._id };
    check('Register user C', regC.status === 201);

    const regAdmin = await req('POST', '/api/auth/register', {
      body: { username: 'boss', email: 'admin@connectx.test', password: 'Password1!' },
    });
    check('ADMIN_EMAIL account becomes admin',
      regAdmin.status === 201 && regAdmin.data.user.role === 'admin');
    const ADMIN = { token: regAdmin.data.accessToken, id: regAdmin.data.user._id };

    // Spec 8.2: duplicate registration is rejected
    const dup = await req('POST', '/api/auth/register', {
      body: { username: 'ahmad2', email: 'AHMAD@test.dev', password: 'Password1!' },
    });
    check('Duplicate registration rejected (case-insensitive email)', dup.status === 400);

    // Spec 8.1: invalid login credentials are rejected
    const badLogin = await req('POST', '/api/auth/login', {
      body: { email: 'ahmad@test.dev', password: 'WrongPassword9' },
    });
    check('Invalid login rejected with 401', badLogin.status === 401);

    // Spec 8.3: protected endpoints require authentication
    const noAuth = await req('GET', '/api/users/me');
    check('Unauthenticated request rejected with 401', noAuth.status === 401);

    // Login + refresh-cookie flow
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ahmad@test.dev', password: 'Password1!' }),
    });
    const loginData = await loginRes.json();
    const cookie = loginRes.headers.get('set-cookie') || '';
    check('Login succeeds and sets HttpOnly refresh cookie',
      loginRes.status === 200 && cookie.includes('connectx_refresh') && cookie.toLowerCase().includes('httponly'));
    A.token = loginData.accessToken;

    const refresh = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookie.split(';')[0] },
    });
    const refreshData = await refresh.json();
    check('Refresh token rotates into a new access token',
      refresh.status === 200 && !!refreshData.accessToken);

    // --- Private conversation -------------------------------------------------
    const convRes = await req('POST', '/api/conversations', {
      token: A.token,
      body: { type: 'private', participantId: B.id },
    });
    check('Create private conversation A<->B', convRes.status === 201);
    const convId = convRes.data.conversation._id;

    const convAgain = await req('POST', '/api/conversations', {
      token: B.token,
      body: { type: 'private', participantId: A.id },
    });
    check('Private conversation is unique per pair (no duplicate created)',
      convAgain.status === 201 && convAgain.data.conversation._id === convId);

    // Spec 8.4: another user cannot open the private chat
    const cPeek = await req('GET', `/api/messages/${convId}`, { token: C.token });
    check("Outsider cannot read another pair's messages (403)", cPeek.status === 403);
    const cPeekConv = await req('GET', `/api/conversations/${convId}`, { token: C.token });
    check('Outsider cannot open the private conversation (403)', cPeekConv.status === 403);

    // --- Real-time messaging over Socket.IO ------------------------------------
    const sockA = await connectSocket(A.token);
    const sockB = await connectSocket(B.token);
    check('Sockets connect with valid JWTs', sockA.connected && sockB.connected);

    const badSocket = io(BASE, { auth: { token: 'not-a-token' }, reconnection: false });
    const badSocketFailed = await new Promise((resolve) => {
      badSocket.on('connect_error', () => resolve(true));
      setTimeout(() => resolve(false), 5000);
    });
    check('Socket with invalid token is rejected', badSocketFailed);
    badSocket.close();

    await emitAck(sockA, 'join_conversation', { conversationId: convId });
    await emitAck(sockB, 'join_conversation', { conversationId: convId });

    // Spec 8.5: two users exchange messages in real time
    const incomingPromise = waitEvent(sockB, 'new_message');
    const ack = await emitAck(sockA, 'send_message', {
      conversationId: convId,
      content: 'Salam Bilal, real-time test',
      clientMessageId: 'test-msg-1',
    });
    check('Socket send_message acknowledged', ack.ok === true && !!ack.message);
    const incoming = await incomingPromise;
    check('B receives the message live via new_message',
      incoming.message.content === 'Salam Bilal, real-time test' &&
        incoming.message.conversationId === convId);
    const msgId = ack.message._id;

    // Notification was created for B
    const notifs = await req('GET', '/api/notifications', { token: B.token });
    check('B has an unread notification for the new message',
      notifs.status === 200 && notifs.data.unreadCount >= 1);

    // Spec 8.7: retrying the same send must not duplicate the message
    const retryAck = await emitAck(sockA, 'send_message', {
      conversationId: convId,
      content: 'Salam Bilal, real-time test',
      clientMessageId: 'test-msg-1',
    });
    check('Retried send is flagged duplicate', retryAck.ok === true && retryAck.duplicate === true);
    const history1 = await req('GET', `/api/messages/${convId}`, { token: B.token });
    const matching = history1.data.messages.filter((m) => m.clientMessageId === 'test-msg-1');
    check('History contains exactly one copy of the retried message', matching.length === 1);

    // Typing indicator
    const typingPromise = waitEvent(sockB, 'typing_start');
    sockA.emit('typing_start', { conversationId: convId });
    const typingPayload = await typingPromise;
    check('Typing indicator reaches the other user', typingPayload.userId === A.id);
    sockA.emit('typing_stop', { conversationId: convId });

    // Read receipts
    const readPromise = waitEvent(sockA, 'message_read');
    const readRes = await req('POST', `/api/conversations/${convId}/read`, { token: B.token });
    check('Mark-read endpoint succeeds', readRes.status === 200);
    const readPayload = await readPromise;
    check('Sender receives message_read receipt', readPayload.userId === B.id);
    const history2 = await req('GET', `/api/messages/${convId}`, { token: A.token });
    const readMsg = history2.data.messages.find((m) => m._id === msgId);
    check('Message readBy now includes B', !!readMsg && readMsg.readBy.includes(B.id));

    // Spec 8.8: only the sender may edit a message
    const editByOther = await req('PATCH', `/api/messages/${msgId}`, {
      token: B.token,
      body: { content: 'hijacked' },
    });
    check("Editing someone else's message is rejected (403)", editByOther.status === 403);
    const editOwn = await req('PATCH', `/api/messages/${msgId}`, {
      token: A.token,
      body: { content: 'Salam Bilal, real-time test (edited)' },
    });
    check('Sender can edit own message',
      editOwn.status === 200 && editOwn.data.message.content.includes('(edited)') && !!editOwn.data.message.editedAt);

    // Reactions toggle
    const react1 = await req('POST', `/api/messages/${msgId}/reactions`, {
      token: B.token,
      body: { emoji: '👍' },
    });
    check('Reaction adds', react1.status === 200 && react1.data.message.reactions.length === 1);
    const react2 = await req('POST', `/api/messages/${msgId}/reactions`, {
      token: B.token,
      body: { emoji: '👍' },
    });
    check('Same reaction toggles off', react2.status === 200 && react2.data.message.reactions.length === 0);

    // --- Uploads ---------------------------------------------------------------
    const form = new FormData();
    form.append('file', new Blob(['hello connectx'], { type: 'text/plain' }), 'note.txt');
    const upRes = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${A.token}` },
      body: form,
    });
    const upData = await upRes.json();
    check('Text file upload accepted', upRes.status === 201 && !!upData.url);

    // Spec 8.9: unsupported file types are rejected
    const formBad = new FormData();
    formBad.append('file', new Blob(['MZ'], { type: 'application/octet-stream' }), 'virus.exe');
    const upBad = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${A.token}` },
      body: formBad,
    });
    check('Executable upload rejected (400)', upBad.status === 400);

    // Typeless uploads from phone pickers: when the declared type is
    // application/octet-stream, the kind is inferred from the extension.
    const formOctetImg = new FormData();
    formOctetImg.append('file', new Blob(['fake-jpeg-bytes'], { type: 'application/octet-stream' }), 'photo.jpg');
    const upOctetImg = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${A.token}` },
      body: formOctetImg,
    });
    const upOctetImgData = await upOctetImg.json().catch(() => ({}));
    check('Typeless (.jpg, octet-stream) upload is accepted and classified as image',
      upOctetImg.status === 201 && upOctetImgData.messageType === 'image' && !!upOctetImgData.url);

    const formOctetVideo = new FormData();
    formOctetVideo.append('file', new Blob(['fake-mp4-bytes'], { type: 'application/octet-stream' }), 'clip.mp4');
    const upOctetVideo = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${A.token}` },
      body: formOctetVideo,
    });
    const upOctetVideoData = await upOctetVideo.json().catch(() => ({}));
    check('Typeless (.mp4, octet-stream) upload is accepted and classified as video',
      upOctetVideo.status === 201 && upOctetVideoData.messageType === 'video' && !!upOctetVideoData.url);

    // HEIC photos get their own clear error, not a generic rejection.
    const formHeic = new FormData();
    formHeic.append('file', new Blob(['fake-heic-bytes'], { type: 'image/heic' }), 'photo.heic');
    const upHeic = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${A.token}` },
      body: formHeic,
    });
    const upHeicData = await upHeic.json().catch(() => ({}));
    check('HEIC upload is rejected with a clear HEIC message (400)',
      upHeic.status === 400 && /HEIC/i.test(upHeicData.message || ''));

    // --- Groups ------------------------------------------------------------------
    const groupRes = await req('POST', '/api/conversations', {
      token: A.token,
      body: { type: 'group', groupName: 'Dev Team', memberIds: [B.id] },
    });
    check('Create group with members', groupRes.status === 201);
    const groupId = groupRes.data.conversation._id;

    const cGroupPeek = await req('GET', `/api/conversations/${groupId}`, { token: C.token });
    check('Non-member cannot open the group (403)', cGroupPeek.status === 403);

    const addC = await req('POST', `/api/conversations/${groupId}/members`, {
      token: A.token,
      body: { userId: C.id },
    });
    check('Group admin can add a member', addC.status === 200);
    const cGroupOk = await req('GET', `/api/conversations/${groupId}`, { token: C.token });
    check('Added member can open the group', cGroupOk.status === 200);

    const nonAdminAdd = await req('POST', `/api/conversations/${groupId}/members`, {
      token: B.token,
      body: { userId: C.id },
    });
    check('Non-admin member cannot add members (403)', nonAdminAdd.status === 403);

    // Spec 8.10: leaving a group ends access
    const leave = await req('POST', `/api/conversations/${groupId}/leave`, { token: C.token });
    check('Member can leave the group', leave.status === 200);
    const cAfterLeave = await req('GET', `/api/conversations/${groupId}`, { token: C.token });
    check('Access ends after leaving the group (403)', cAfterLeave.status === 403);

    // --- Blocking ------------------------------------------------------------------
    const block = await req('POST', `/api/users/${A.id}/block`, { token: B.token });
    check('B can block A', block.status === 200);
    const blockedSend = await req('POST', '/api/conversations', {
      token: A.token,
      body: { type: 'private', participantId: B.id },
    });
    check('Blocked user cannot start a chat (403)', blockedSend.status === 403);
    await req('POST', `/api/users/${A.id}/unblock`, { token: B.token });

    // --- Reports + Admin ------------------------------------------------------------
    const report = await req('POST', '/api/reports', {
      token: B.token,
      body: { reportedUser: A.id, messageId: msgId, reason: 'Spam test report' },
    });
    check('User can file a report', report.status === 201);

    const statsForbidden = await req('GET', '/api/admin/stats', { token: B.token });
    check('Non-admin cannot access admin stats (403)', statsForbidden.status === 403);
    const stats = await req('GET', '/api/admin/stats', { token: ADMIN.token });
    check('Admin stats work', stats.status === 200 && stats.data.stats.users >= 4);

    const adminReports = await req('GET', '/api/admin/reports', { token: ADMIN.token });
    check('Admin can review reports',
      adminReports.status === 200 && adminReports.data.reports.length >= 1);

    const suspend = await req('PATCH', `/api/admin/users/${C.id}/suspend`, {
      token: ADMIN.token,
      body: { suspend: true },
    });
    check('Admin can suspend a user', suspend.status === 200 && suspend.data.user.isBlocked === true);
    const suspendedLogin = await req('POST', '/api/auth/login', {
      body: { email: 'charlie@test.dev', password: 'Password1!' },
    });
    check('Suspended user cannot log in (403)', suspendedLogin.status === 403);
    await req('PATCH', `/api/admin/users/${C.id}/suspend`, {
      token: ADMIN.token,
      body: { suspend: false },
    });

    // --- Password reset (invalid token rejected) --------------------------------------
    const forgot = await req('POST', '/api/auth/forgot-password', {
      body: { email: 'bilal@test.dev' },
    });
    check('Forgot-password answers generically', forgot.status === 200);
    const badReset = await req('POST', '/api/auth/reset-password', {
      body: { token: 'deadbeef'.repeat(8), newPassword: 'NewPassword1!' },
    });
    check('Reset with invalid token rejected (400)', badReset.status === 400);

    // --- Delete own message --------------------------------------------------------------
    const restMsg = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'to be deleted', clientMessageId: 'test-msg-2' },
    });
    check('REST message send works', restMsg.status === 201);
    const delByOther = await req('DELETE', `/api/messages/${restMsg.data.message._id}`, { token: B.token });
    check("Deleting someone else's message is rejected (403)", delByOther.status === 403);
    const delOwn = await req('DELETE', `/api/messages/${restMsg.data.message._id}`, { token: A.token });
    check('Sender can delete own message (soft delete)',
      delOwn.status === 200 && !!delOwn.data.message.deletedAt && delOwn.data.message.content === '');

    // --- WhatsApp upgrade: delete for everyone is visible to all -------------------
    const everyoneMsg = await req('POST', '/api/messages', {
      token: B.token,
      body: { conversationId: convId, content: 'delete for everyone test', clientMessageId: 'test-msg-everyone' },
    });
    check('B sends a message for the delete-for-everyone test', everyoneMsg.status === 201);
    const everyoneId = everyoneMsg.data.message._id;
    const delEveryone = await req('DELETE', `/api/messages/${everyoneId}`, { token: B.token });
    check('Sender deletes own message for everyone', delEveryone.status === 200 && !!delEveryone.data.message.deletedAt);
    const aHistoryAfterDel = await req('GET', `/api/messages/${convId}`, { token: A.token });
    const aSeesDeleted = aHistoryAfterDel.data.messages.find((m) => m._id === everyoneId);
    check('Delete-for-everyone: other participant sees it as deleted (content cleared)',
      !!aSeesDeleted && !!aSeesDeleted.deletedAt && aSeesDeleted.content === '');

    // --- WhatsApp upgrade: delete for me (per-user hide) ---------------------------
    const hideMsg = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'hide me from B only', clientMessageId: 'test-msg-hide' },
    });
    check('A sends a message for the delete-for-me test', hideMsg.status === 201);
    const hideId = hideMsg.data.message._id;
    const bBefore = await req('GET', `/api/messages/${convId}`, { token: B.token });
    check('B sees the message before hiding it',
      bBefore.data.messages.some((m) => m._id === hideId));
    const hideRes = await req('POST', `/api/messages/${hideId}/hide`, { token: B.token });
    check('B can delete-for-me (hide) a message', hideRes.status === 200 && hideRes.data.ok === true);
    const bAfter = await req('GET', `/api/messages/${convId}`, { token: B.token });
    check('Hidden message is gone from B history',
      !bAfter.data.messages.some((m) => m._id === hideId));
    const aAfter = await req('GET', `/api/messages/${convId}`, { token: A.token });
    check('Hidden message still visible to A (sender unaffected)',
      aAfter.data.messages.some((m) => m._id === hideId));
    const cHide = await req('POST', `/api/messages/${hideId}/hide`, { token: C.token });
    check('Non-member cannot hide messages in a conversation (403)', cHide.status === 403);

    // --- WhatsApp upgrade: status (stories) -----------------------------------------
    const statusRes = await req('POST', '/api/status', {
      token: A.token,
      body: { type: 'text', text: 'Shipping the WhatsApp upgrade', backgroundColor: '#123456' },
    });
    check('Create a text status', statusRes.status === 201 && statusRes.data.status.type === 'text');
    const statusId = statusRes.data.status._id;
    const ttlMs = new Date(statusRes.data.status.expiresAt) - Date.now();
    check('Status expires in ~24h', ttlMs > 23 * 3600 * 1000 && ttlMs <= 24 * 3600 * 1000 + 5000);

    const badStatus = await req('POST', '/api/status', {
      token: A.token,
      body: { type: 'image' },
    });
    check('Image status without mediaUrl is rejected (400)', badStatus.status === 400);

    const noAuthFeed = await req('GET', '/api/status/feed');
    check('Status feed requires auth (401)', noAuthFeed.status === 401);

    const bFeed1 = await req('GET', '/api/status/feed', { token: B.token });
    const bGroupA = (bFeed1.data.groups || []).find((g) => g.user._id === A.id);
    check('Contact (shares a conversation) sees the status as unviewed',
      !!bGroupA && bGroupA.hasUnviewed === true && bGroupA.statuses.length >= 1);

    const cFeed = await req('GET', '/api/status/feed', { token: C.token });
    check('User with no shared conversation does not see the status',
      !(cFeed.data.groups || []).some((g) => g.user._id === A.id));
    const cView = await req('POST', `/api/status/${statusId}/view`, { token: C.token });
    check('Outsider cannot record a view (403)', cView.status === 403);

    const viewRes = await req('POST', `/api/status/${statusId}/view`, { token: B.token });
    check('Contact can record a view', viewRes.status === 200 && viewRes.data.viewed === true);
    const bFeed2 = await req('GET', '/api/status/feed', { token: B.token });
    const bGroupA2 = (bFeed2.data.groups || []).find((g) => g.user._id === A.id);
    check('After viewing, the group is no longer unviewed for B',
      !!bGroupA2 && bGroupA2.hasUnviewed === false);

    const aFeed = await req('GET', '/api/status/feed', { token: A.token });
    const aOwn = (aFeed.data.groups || []).find((g) => g.user._id === A.id);
    const aOwnStatus = aOwn && aOwn.statuses.find((s) => s._id === statusId);
    check('Owner sees own status with 1 viewer (B)',
      !!aOwnStatus && aOwnStatus.viewersCount === 1 &&
        aOwnStatus.viewers.some((v) => v.user && v.user.username === 'bilal'));

    const bDeleteStatus = await req('DELETE', `/api/status/${statusId}`, { token: B.token });
    check("Deleting someone else's status is rejected (403)", bDeleteStatus.status === 403);
    const aDeleteStatus = await req('DELETE', `/api/status/${statusId}`, { token: A.token });
    check('Owner can delete own status', aDeleteStatus.status === 200);
    const bFeed3 = await req('GET', '/api/status/feed', { token: B.token });
    check('Deleted status disappears from the feed',
      !(bFeed3.data.groups || []).some((g) => g.user._id === A.id));

    const imgStatus = await req('POST', '/api/status', {
      token: A.token,
      body: { type: 'image', mediaUrl: 'https://example.com/status-photo.jpg' },
    });
    check('Create an image status', imgStatus.status === 201 && imgStatus.data.status.type === 'image');
    await req('DELETE', `/api/status/${imgStatus.data.status._id}`, { token: A.token });

    // --- WhatsApp upgrade: group creation flow (members + name + avatar) --------------
    const richGroup = await req('POST', '/api/conversations', {
      token: A.token,
      body: {
        type: 'group',
        groupName: 'Study Group',
        groupImage: 'https://example.com/group.png',
        memberIds: [B.id, C.id],
      },
    });
    check('Create group with members, name and avatar',
      richGroup.status === 201 &&
        richGroup.data.conversation.type === 'group' &&
        richGroup.data.conversation.groupName === 'Study Group' &&
        richGroup.data.conversation.groupImage === 'https://example.com/group.png' &&
        richGroup.data.conversation.participants.length === 3);
    check('Group creator is admin', richGroup.data.conversation.myRole === 'admin');
    const richGroupId = richGroup.data.conversation._id;
    const bGroupView = await req('GET', `/api/conversations/${richGroupId}`, { token: B.token });
    check('Added group member can open the group as a member',
      bGroupView.status === 200 && bGroupView.data.conversation.myRole === 'member');
    const groupMsg = await req('POST', '/api/messages', {
      token: C.token,
      body: { conversationId: richGroupId, content: 'Hello Study Group', clientMessageId: 'test-msg-group' },
    });
    check('Group member can post in the group', groupMsg.status === 201);

    // --- v3.0 Phase A: preferences -------------------------------------
    const prefLoad = await req('GET', '/api/users/me/preferences', { token: A.token });
    check('preferences: defaults load (wallpaper + accent present)',
      prefLoad.status === 200 &&
        prefLoad.data.preferences.wallpaper === 'default' &&
        /^#[0-9a-fA-F]{6}$/.test(prefLoad.data.preferences.accentColor));
    const prefSave = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { wallpaper: 'ocean', accentColor: '#8b5cf6', wallpaperDim: 60 },
    });
    check('preferences: wallpaper + accent + dim save and reload',
      prefSave.status === 200 &&
        prefSave.data.preferences.wallpaper === 'ocean' &&
        prefSave.data.preferences.accentColor === '#8b5cf6' &&
        prefSave.data.preferences.wallpaperDim === 60);
    const prefBad = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { accentColor: 'red' },
    });
    check('preferences: non-hex accent color is rejected (400)', prefBad.status === 400);
    const prefWp = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { conversationWallpapers: [{ conversationId: convId, wallpaper: 'sunset', dim: 30 }] },
    });
    const wpEntry = (prefWp.data.preferences?.conversationWallpapers || []).find(
      (c) => c.conversationId === convId);
    check('preferences: per-conversation wallpaper persists',
      prefWp.status === 200 && !!wpEntry && wpEntry.wallpaper === 'sunset' && wpEntry.dim === 30);

    // --- Polish phase: theme + live-weather preferences -------------------
    check('preferences: theme defaults to light and live-weather background defaults on',
      prefLoad.data.preferences.theme === 'light' &&
        prefLoad.data.preferences.liveWeatherBackground === true);
    const themeSave = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { theme: 'dark', liveWeatherBackground: false },
    });
    const themeReload = await req('GET', '/api/users/me/preferences', { token: A.token });
    check('preferences: theme + live-weather background save and reload',
      themeSave.status === 200 &&
        themeSave.data.preferences.theme === 'dark' &&
        themeSave.data.preferences.liveWeatherBackground === false &&
        themeReload.data.preferences.theme === 'dark');
    const themeBad = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { theme: 'neon' },
    });
    check('preferences: invalid theme value is rejected (400)', themeBad.status === 400);
    const wpLive = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { wallpaper: 'live-weather' },
    });
    check("preferences: 'live-weather' wallpaper key persists",
      wpLive.status === 200 && wpLive.data.preferences.wallpaper === 'live-weather');
    const ffSave = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { fontFamily: 'classic', easyMode: true },
    });
    const ffReload = await req('GET', '/api/users/me/preferences', { token: A.token });
    check('preferences: fontFamily + easyMode save and reload',
      ffSave.status === 200 &&
        ffReload.data.preferences.fontFamily === 'classic' &&
        ffReload.data.preferences.easyMode === true);
    const ffBad = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { fontFamily: 'comic' },
    });
    check('preferences: invalid fontFamily is rejected (400)', ffBad.status === 400);
    // Restore the choices later sections do not depend on, to be safe.
    await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { theme: 'light', liveWeatherBackground: true, wallpaper: 'ocean' },
    });

    // --- v3.0 Phase A: contact cards ------------------------------------
    const regD = await req('POST', '/api/auth/register', {
      body: { username: 'dave', email: 'dave@test.dev', password: 'Password1!' },
    });
    const D = { token: regD.data.accessToken, id: regD.data.user._id };
    check('Register user D (stranger for contact-card checks)', regD.status === 201);

    const ccSave = await req('PATCH', '/api/users/me/contact-card', {
      token: B.token,
      body: {
        fields: {
          phone: '+92 300 1111111',
          city: 'Peshawar',
          website: 'https://bilal.example.com',
          homeAddress: 'House 1, Test Street',
        },
        visibility: { phone: 'nobody', city: 'contacts', website: 'everyone', homeAddress: 'contacts' },
      },
    });
    check('contact card: owner saves fields with per-field visibility',
      ccSave.status === 200 && ccSave.data.contactCard.fields.city === 'Peshawar');
    const ccPublicHome = await req('PATCH', '/api/users/me/contact-card', {
      token: B.token,
      body: { visibility: { homeAddress: 'everyone' } },
    });
    check('contact card: homeAddress can never be set to everyone (400)',
      ccPublicHome.status === 400);

    const ccPartner = await req('GET', `/api/users/${B.id}/contact-card`, { token: A.token });
    check('contact card: conversation partner sees contacts fields + email, not nobody fields',
      ccPartner.status === 200 &&
        ccPartner.data.contactCard.fields.city === 'Peshawar' &&
        ccPartner.data.contactCard.fields.homeAddress === 'House 1, Test Street' &&
        ccPartner.data.contactCard.fields.website === 'https://bilal.example.com' &&
        !('phone' in ccPartner.data.contactCard.fields) &&
        ccPartner.data.contactCard.email === 'bilal@test.dev');
    const ccStranger = await req('GET', `/api/users/${B.id}/contact-card`, { token: D.token });
    check('contact card: stranger sees only everyone fields and no email',
      ccStranger.status === 200 &&
        ccStranger.data.contactCard.fields.website === 'https://bilal.example.com' &&
        !('city' in ccStranger.data.contactCard.fields) &&
        !('homeAddress' in ccStranger.data.contactCard.fields) &&
        !('phone' in ccStranger.data.contactCard.fields) &&
        ccStranger.data.contactCard.email === undefined);
    const ccOwn = await req('GET', '/api/users/me/contact-card', { token: B.token });
    check('contact card: owner still sees own nobody-visibility fields',
      ccOwn.status === 200 && ccOwn.data.contactCard.fields.phone === '+92 300 1111111');
    const pubProfile = await req('GET', `/api/users/${B.id}`, { token: A.token });
    check('users: public profile never embeds contact card or preferences',
      pubProfile.status === 200 &&
        pubProfile.data.user.contactCard === undefined &&
        pubProfile.data.user.preferences === undefined);

    // --- v3.0 Phase A: weather (stubbed provider) ------------------------
    const wxAnon = await req('GET', '/api/weather/current?city=Test%20City');
    check('weather: unauthenticated request is rejected (401)', wxAnon.status === 401);
    const wxCurrent = await req('GET', '/api/weather/current?city=Test%20City', { token: A.token });
    check('weather: current conditions by city name (geocoding + contract)',
      wxCurrent.status === 200 &&
        wxCurrent.data.location.name === 'Test City' &&
        wxCurrent.data.current.temperature === 24.5 &&
        wxCurrent.data.current.condition === 'Mainly clear');
    const wxForecast = await req('GET', '/api/weather/forecast?lat=33.6&lon=73.1', { token: A.token });
    check('weather: forecast returns 24 hourly + 7 daily entries',
      wxForecast.status === 200 &&
        wxForecast.data.hourly.length === 24 &&
        wxForecast.data.daily.length === 7 &&
        typeof wxForecast.data.daily[0].max === 'number');
    // --- Prayer times (Namaz): stubbed Aladhan provider ------------------
    const prAnon = await req('GET', '/api/prayer-times?lat=34.01&lon=71.52');
    check('prayer: unauthenticated request is rejected (401)', prAnon.status === 401);
    const prMissing = await req('GET', '/api/prayer-times', { token: A.token });
    check('prayer: missing lat/lon is rejected (400)', prMissing.status === 400);
    const prHanafi = await req('GET', '/api/prayer-times?lat=34.0151&lon=71.5249', { token: A.token });
    check('prayer: Karachi + Hanafi defaults (Asr 15:33, six timings, hijri, timezone)',
      prHanafi.status === 200 &&
        prHanafi.data.timings.Fajr === '05:19' &&
        prHanafi.data.timings.Asr === '15:33' &&
        prHanafi.data.timings.Isha === '18:37' &&
        prHanafi.data.hijri.month === 'Jumada al-awwal' &&
        prHanafi.data.timezone === 'Asia/Karachi');
    const prShafi = await req('GET', '/api/prayer-times?lat=33.6&lon=73.1&school=0', { token: A.token });
    check('prayer: Shafi juristic method moves Asr earlier (14:51)',
      prShafi.status === 200 && prShafi.data.timings.Asr === '14:51');


    // --- v3.0 Phase B: voice messages (Module 5) -------------------------
    const audioForm = new FormData();
    audioForm.append(
      'file',
      new Blob([Buffer.from('fake-voice-bytes')], { type: 'audio/webm' }),
      'note.webm'
    );
    const voiceUpRes = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${A.token}` },
      body: audioForm,
    });
    const voiceUpData = await voiceUpRes.json().catch(() => ({}));
    check('voice: audio upload accepted through the uploads pipeline',
      voiceUpRes.status === 201 && voiceUpData.messageType === 'audio' && !!voiceUpData.url);
    const voiceMsg = await req('POST', '/api/messages', {
      token: A.token,
      body: {
        conversationId: convId,
        messageType: 'audio',
        attachmentUrl: voiceUpData.url,
        clientMessageId: 'test-voice-1',
        audioMeta: { duration: 3.25, waveform: [0.2, 0.9, 0.5, 0.1] },
      },
    });
    check('voice: message is created with type audio',
      voiceMsg.status === 201 && voiceMsg.data.message.messageType === 'audio');
    check('voice: duration + waveform metadata are stored',
      voiceMsg.status === 201 &&
        Math.abs(voiceMsg.data.message.audioMeta.duration - 3.25) < 0.001 &&
        JSON.stringify(voiceMsg.data.message.audioMeta.waveform) === JSON.stringify([0.2, 0.9, 0.5, 0.1]));
    const bVoiceHistory = await req('GET', `/api/messages/${convId}?limit=100`, { token: B.token });
    const voiceSeen = (bVoiceHistory.data.messages || []).find(
      (m) => m._id === voiceMsg.data.message._id
    );
    check('voice: recipient history carries the audio metadata',
      !!voiceSeen &&
        voiceSeen.messageType === 'audio' &&
        Math.abs(voiceSeen.audioMeta.duration - 3.25) < 0.001 &&
        voiceSeen.audioMeta.waveform.length === 4);

    // --- v3.0 Phase B: polls ----------------------------------------------
    const pollRes = await req('POST', '/api/messages', {
      token: A.token,
      body: {
        conversationId: convId,
        messageType: 'poll',
        poll: { question: 'Best day?', options: ['Sat', 'Sun', 'Mon'], allowMultiple: false },
        clientMessageId: 'test-poll-1',
      },
    });
    check('poll: created with question + options persisted',
      pollRes.status === 201 &&
        pollRes.data.message.messageType === 'poll' &&
        pollRes.data.message.poll.question === 'Best day?' &&
        pollRes.data.message.poll.options.length === 3 &&
        pollRes.data.message.poll.closed === false);
    const pollId = pollRes.data.message._id;
    const optByText = (msg, text) => msg.poll.options.find((o) => o.text === text);
    const voteSun = await req('POST', `/api/messages/${pollId}/vote`, {
      token: B.token,
      body: { optionIds: [optByText(pollRes.data.message, 'Sun')._id] },
    });
    check('poll: vote is recorded with the voter id',
      voteSun.status === 200 &&
        optByText(voteSun.data.message, 'Sun').votes.includes(B.id) &&
        optByText(voteSun.data.message, 'Sat').votes.length === 0);
    const voteMove = await req('POST', `/api/messages/${pollId}/vote`, {
      token: B.token,
      body: { optionIds: [optByText(pollRes.data.message, 'Mon')._id] },
    });
    check('poll: single-choice vote moves to the new option',
      voteMove.status === 200 &&
        optByText(voteMove.data.message, 'Mon').votes.includes(B.id) &&
        optByText(voteMove.data.message, 'Sun').votes.length === 0);
    const voteClear = await req('POST', `/api/messages/${pollId}/vote`, {
      token: B.token,
      body: { optionIds: [] },
    });
    check('poll: voting with an empty set unvotes',
      voteClear.status === 200 &&
        voteClear.data.message.poll.options.every((o) => o.votes.length === 0));
    const cVote = await req('POST', `/api/messages/${pollId}/vote`, {
      token: C.token,
      body: { optionIds: [optByText(pollRes.data.message, 'Sat')._id] },
    });
    check('poll: non-member cannot vote (403)', cVote.status === 403);
    const multiPoll = await req('POST', '/api/messages', {
      token: A.token,
      body: {
        conversationId: richGroupId,
        messageType: 'poll',
        poll: { question: 'Snacks?', options: ['Chips', 'Samosa'], allowMultiple: true },
        clientMessageId: 'test-poll-2',
      },
    });
    const bMultiVote = await req('POST', `/api/messages/${multiPoll.data.message._id}/vote`, {
      token: B.token,
      body: { optionIds: multiPoll.data.message.poll.options.map((o) => o._id) },
    });
    check('poll: multiple-choice poll accepts two votes from one user',
      bMultiVote.status === 200 &&
        bMultiVote.data.message.poll.options.every((o) => o.votes.includes(B.id)));
    const closeByOther = await req('POST', `/api/messages/${pollId}/poll/close`, { token: B.token });
    check('poll: only the creator can close it (403 for others)', closeByOther.status === 403);
    const closeByCreator = await req('POST', `/api/messages/${pollId}/poll/close`, { token: A.token });
    check('poll: creator closes the poll',
      closeByCreator.status === 200 && closeByCreator.data.message.poll.closed === true);
    const voteAfterClose = await req('POST', `/api/messages/${pollId}/vote`, {
      token: B.token,
      body: { optionIds: [optByText(pollRes.data.message, 'Sat')._id] },
    });
    check('poll: voting after close is refused (400)', voteAfterClose.status === 400);

    // --- v3.0 Phase B: archived chats (Module 20) --------------------------
    await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'archive unread probe', clientMessageId: 'test-archive-probe' },
    });
    const archRes = await req('POST', `/api/conversations/${convId}/archive`, { token: B.token });
    check('archive: endpoint archives for the archiving user', archRes.status === 200);
    const bMainAfterArch = await req('GET', '/api/conversations', { token: B.token });
    check('archive: chat leaves the main list',
      !(bMainAfterArch.data.conversations || []).some((c) => c._id === convId));
    const bArchList = await req('GET', '/api/conversations?view=archived', { token: B.token });
    const archEntry = (bArchList.data.conversations || []).find((c) => c._id === convId);
    check('archive: chat appears in the archived view with its unread count',
      !!archEntry && archEntry.unreadCount >= 1);
    await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'wake up, archived chat', clientMessageId: 'test-archive-wake' },
    });
    const bMainAfterWake = await req('GET', '/api/conversations', { token: B.token });
    const bArchAfterWake = await req('GET', '/api/conversations?view=archived', { token: B.token });
    check('archive: a new incoming message auto-unarchives the chat',
      (bMainAfterWake.data.conversations || []).some((c) => c._id === convId) &&
        !(bArchAfterWake.data.conversations || []).some((c) => c._id === convId));
    await req('POST', `/api/conversations/${convId}/archive`, { token: B.token });
    const unarchRes = await req('POST', `/api/conversations/${convId}/unarchive`, { token: B.token });
    const bMainAfterUnarch = await req('GET', '/api/conversations', { token: B.token });
    check('archive: unarchive returns the chat to the main list',
      unarchRes.status === 200 &&
        (bMainAfterUnarch.data.conversations || []).some((c) => c._id === convId));

    // --- Polish phase: pinned chats ----------------------------------------
    const pinRes = await req('POST', `/api/conversations/${convId}/pin`, { token: B.token });
    check('pin: endpoint pins for the pinning user', pinRes.status === 200 && pinRes.data.pinned === true);
    const bListPinned = await req('GET', '/api/conversations', { token: B.token });
    const bPinnedList = bListPinned.data.conversations || [];
    check('pin: pinned conversation is flagged and sorts first in the list',
      bPinnedList.length > 0 &&
        bPinnedList[0]._id === convId &&
        bPinnedList[0].pinned === true);
    const aListPin = await req('GET', '/api/conversations', { token: A.token });
    const aEntryPin = (aListPin.data.conversations || []).find((c) => c._id === convId);
    check('pin: pin state is per-user (the other participant is unaffected)',
      !!aEntryPin && aEntryPin.pinned === false);
    const unpinRes = await req('POST', `/api/conversations/${convId}/unpin`, { token: B.token });
    const bListUnpinned = await req('GET', '/api/conversations', { token: B.token });
    const bEntryUnpinned = (bListUnpinned.data.conversations || []).find((c) => c._id === convId);
    check('pin: unpin clears the flag',
      unpinRes.status === 200 && unpinRes.data.pinned === false &&
        !!bEntryUnpinned && bEntryUnpinned.pinned === false);
    const cPinRes = await req('POST', `/api/conversations/${convId}/pin`, { token: C.token });
    check('pin: a non-member cannot pin the conversation (403)', cPinRes.status === 403);

    // --- Polish phase: video messages --------------------------------------
    const videoForm = new FormData();
    videoForm.append(
      'file',
      new Blob([Buffer.from('fake-video-bytes')], { type: 'video/mp4' }),
      'clip.mp4'
    );
    const videoUpRes = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${A.token}` },
      body: videoForm,
    });
    const videoUpData = await videoUpRes.json().catch(() => ({}));
    check('video: mp4 upload accepted and classified as video',
      videoUpRes.status === 201 && videoUpData.messageType === 'video' && !!videoUpData.url);
    const videoMsg = await req('POST', '/api/messages', {
      token: A.token,
      body: {
        conversationId: convId,
        messageType: 'video',
        attachmentUrl: videoUpData.url,
        clientMessageId: 'test-video-1',
        videoMeta: { duration: 12.5, size: 16, mime: 'video/mp4' },
      },
    });
    check('video: message is created with type video',
      videoMsg.status === 201 && videoMsg.data.message.messageType === 'video');
    check('video: duration + size + mime metadata are stored',
      Math.abs((videoMsg.data.message.videoMeta?.duration || 0) - 12.5) < 0.001 &&
        videoMsg.data.message.videoMeta?.size === 16 &&
        videoMsg.data.message.videoMeta?.mime === 'video/mp4');
    const bHistVideo = await req('GET', `/api/messages/${convId}?limit=50`, { token: B.token });
    const bVideoMsg = (bHistVideo.data.messages || []).find((m) => m._id === videoMsg.data.message._id);
    check('video: recipient history shows the video message with its metadata',
      !!bVideoMsg && bVideoMsg.messageType === 'video' && bVideoMsg.videoMeta?.mime === 'video/mp4');
    const videoNoFile = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, messageType: 'video', attachmentUrl: '' },
    });
    check('video: a video message without an uploaded file is rejected (400)',
      videoNoFile.status === 400);
    const forgedSystem = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, messageType: 'system', content: 'forged notice' },
    });
    check('video/system: clients cannot forge system messages (400)', forgedSystem.status === 400);

    // --- Polish phase: video status -----------------------------------------
    const videoStatus = await req('POST', '/api/status', {
      token: A.token,
      body: { type: 'video', mediaUrl: videoUpData.url },
    });
    check('status video: creation succeeds with type video',
      videoStatus.status === 201 && videoStatus.data.status.type === 'video' &&
        videoStatus.data.status.mediaUrl === videoUpData.url);
    const bFeedVideo = await req('GET', '/api/status/feed', { token: B.token });
    const bGroupVideo = (bFeedVideo.data.groups || []).find(
      (g) => (g.user?._id || g.user) === A.id &&
        (g.statuses || []).some((s) => s._id === videoStatus.data.status._id && s.type === 'video')
    );
    check('status video: the feed carries it to contacts as a video', !!bGroupVideo);
    const videoView = await req('POST', `/api/status/${videoStatus.data.status._id}/view`, {
      token: B.token,
    });
    const aFeedAfterView = await req('GET', '/api/status/feed', { token: A.token });
    const aMineGroup = (aFeedAfterView.data.groups || []).find((g) => g.mine);
    const aVideoStatus = (aMineGroup?.statuses || []).find((s) => s._id === videoStatus.data.status._id);
    check('status video: a view is recorded for the author',
      videoView.status === 200 && !!aVideoStatus && aVideoStatus.viewersCount >= 1);
    const videoStatusNoUrl = await req('POST', '/api/status', {
      token: A.token,
      body: { type: 'video' },
    });
    check('status video: a video status without media is rejected (400)',
      videoStatusNoUrl.status === 400);

    // --- Polish phase: disappearing messages ---------------------------------
    const dmSet = await req('PATCH', `/api/conversations/${convId}`, {
      token: B.token,
      body: { disappearingDurationSec: 2 },
    });
    check('disappearing: a private-chat member can turn the timer on',
      dmSet.status === 200 && dmSet.data.conversation.disappearingDurationSec === 2);
    const histNotice = await req('GET', `/api/messages/${convId}?limit=50`, { token: A.token });
    check('disappearing: a system notice appears in the chat',
      (histNotice.data.messages || []).some(
        (m) => m.messageType === 'system' && /disappearing/i.test(m.content || '')
      ));
    const dmMsg = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'short lived secret', clientMessageId: 'test-dm-1' },
    });
    check('disappearing: new messages get an expiry while the timer is on',
      dmMsg.status === 201 && !!dmMsg.data.message.expiresAt);
    const bHistDm = await req('GET', `/api/messages/${convId}?limit=50`, { token: B.token });
    check('disappearing: the message is visible to both users before expiry',
      (bHistDm.data.messages || []).some((m) => m._id === dmMsg.data.message._id));
    await new Promise((r) => setTimeout(r, 2400));
    const aHistAfter = await req('GET', `/api/messages/${convId}?limit=50`, { token: A.token });
    const bHistAfter = await req('GET', `/api/messages/${convId}?limit=50`, { token: B.token });
    check('disappearing: after expiry the message is gone from history for both users',
      !(aHistAfter.data.messages || []).some((m) => m._id === dmMsg.data.message._id) &&
        !(bHistAfter.data.messages || []).some((m) => m._id === dmMsg.data.message._id));
    await req('PATCH', `/api/conversations/${convId}`, {
      token: B.token,
      body: { disappearingDurationSec: 86400 },
    });
    const dmDay = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'day long secret', clientMessageId: 'test-dm-2' },
    });
    const dmTtlMs = new Date(dmDay.data.message.expiresAt) - Date.now();
    check('disappearing: the 24-hour option stamps an expiry ~24h out',
      dmDay.status === 201 && dmTtlMs > 23 * 3600e3 && dmTtlMs < 25 * 3600e3);
    const dmOff = await req('PATCH', `/api/conversations/${convId}`, {
      token: B.token,
      body: { disappearingDurationSec: 0 },
    });
    const dmPlain = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'permanent again', clientMessageId: 'test-dm-3' },
    });
    check('disappearing: with the timer off, messages carry no expiry again',
      dmOff.status === 200 && dmPlain.status === 201 && !dmPlain.data.message.expiresAt);

    // Group permission + the Settings → Privacy default timer.
    await req('PATCH', '/api/users/me/preferences', {
      token: B.token,
      body: { defaultDisappearingDuration: 86400 },
    });
    const timerGroup = await req('POST', '/api/conversations', {
      token: B.token,
      body: { type: 'group', groupName: 'Timer Group', memberIds: [A.id] },
    });
    check("disappearing: the creator's default timer applies to new conversations",
      timerGroup.status === 201 &&
        timerGroup.data.conversation.disappearingDurationSec === 86400);
    const aGroupDm = await req('PATCH', `/api/conversations/${timerGroup.data.conversation._id}`, {
      token: A.token,
      body: { disappearingDurationSec: 0 },
    });
    check('disappearing: a non-admin group member cannot change the timer (403)',
      aGroupDm.status === 403);
    const bGroupDm = await req('PATCH', `/api/conversations/${timerGroup.data.conversation._id}`, {
      token: B.token,
      body: { disappearingDurationSec: 604800 },
    });
    check('disappearing: a group admin can change the timer',
      bGroupDm.status === 200 &&
        bGroupDm.data.conversation.disappearingDurationSec === 604800);
    await req('PATCH', '/api/users/me/preferences', {
      token: B.token,
      body: { defaultDisappearingDuration: 0 },
    });

    // --- Polish phase: settings preferences (accessibility + notifications) --
    const accSave = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { fontSize: 'large', animationsEnabled: false, soundAlerts: false },
    });
    check('settings prefs: font size + animations + sound alerts save',
      accSave.status === 200 &&
        accSave.data.preferences.fontSize === 'large' &&
        accSave.data.preferences.animationsEnabled === false &&
        accSave.data.preferences.soundAlerts === false);
    const fsBad = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { fontSize: 'huge' },
    });
    check('settings prefs: an invalid font size is rejected (400)', fsBad.status === 400);
    await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { fontSize: 'medium', animationsEnabled: true, soundAlerts: true },
    });
    await req('PATCH', '/api/notifications/read', { token: B.token, body: {} });
    const probe1 = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'preview probe one', clientMessageId: 'test-prev-1' },
    });
    const bNotifs1 = await req('GET', '/api/notifications', { token: B.token });
    const notif1 = (bNotifs1.data.notifications || []).find(
      (n) => n.messageId && n.messageId._id === probe1.data.message._id
    );
    check('settings prefs: notification previews are shown by default',
      !!notif1 && notif1.messageId.content === 'preview probe one');
    await req('PATCH', '/api/users/me/preferences', {
      token: B.token,
      body: { notificationPreviews: false },
    });
    const probe2 = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'preview probe two', clientMessageId: 'test-prev-2' },
    });
    const bNotifs2 = await req('GET', '/api/notifications', { token: B.token });
    const notif2 = (bNotifs2.data.notifications || []).find(
      (n) => n.messageId && n.messageId._id === probe2.data.message._id
    );
    check('settings prefs: turning previews off hides message text in notifications',
      !!notif2 && notif2.messageId.content === '');
    await req('PATCH', '/api/users/me/preferences', {
      token: B.token,
      body: { notificationPreviews: true },
    });

    // --- v3.0 Phase B: locked + hidden chats (Modules 19 + 21) -------------
    const lockConvRes = await req('POST', '/api/conversations', {
      token: A.token,
      body: { type: 'private', participantId: C.id },
    });
    const lockConvId = lockConvRes.data.conversation._id;
    const lockStatus0 = await req('GET', '/api/chat-locks/status', { token: A.token });
    check('lock: status starts with no PIN set',
      lockStatus0.status === 200 && lockStatus0.data.hasPin === false);
    const pinSet = await req('POST', '/api/chat-locks/pin', {
      token: A.token,
      body: { pin: '1357' },
    });
    check('lock: PIN can be set', pinSet.status === 201);
    const pinSetAgain = await req('POST', '/api/chat-locks/pin', {
      token: A.token,
      body: { pin: '1357' },
    });
    check('lock: setting a second PIN directly is refused (400)', pinSetAgain.status === 400);
    const meProfile = await req('GET', '/api/users/me', { token: A.token });
    check('lock: PIN hash never appears in the profile payload',
      meProfile.status === 200 &&
        !('chatLockPinHash' in (meProfile.data.user || {})) &&
        !JSON.stringify(meProfile.data).includes('chatLockPinHash'));
    const lockRes = await req('POST', `/api/chat-locks/${lockConvId}/lock`, { token: A.token });
    check('lock: conversation can be locked', lockRes.status === 200);
    const aMainLocked = await req('GET', '/api/conversations', { token: A.token });
    check('lock: locked chat disappears from the main chat list',
      !(aMainLocked.data.conversations || []).some((c) => c._id === lockConvId));
    const histLocked = await req('GET', `/api/messages/${lockConvId}`, { token: A.token });
    check('lock: history is refused server-side without an unlock grant (423)',
      histLocked.status === 423);
    const detailLocked = await req('GET', `/api/conversations/${lockConvId}`, { token: A.token });
    check('lock: conversation detail is refused without an unlock grant (423)',
      detailLocked.status === 423);
    const sendLockedRest = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: lockConvId, content: 'should not land', clientMessageId: 'test-locked-send' },
    });
    check('lock: REST send into a locked chat is refused (423)', sendLockedRest.status === 423);
    await req('POST', '/api/messages', {
      token: C.token,
      body: { conversationId: lockConvId, content: 'secret hello from C', clientMessageId: 'test-locked-incoming' },
    });
    const aNotifs = await req('GET', '/api/notifications', { token: A.token });
    check('lock: locked chat content never leaks into notifications',
      !(aNotifs.data.notifications || []).some((n) => n.conversationId === lockConvId) &&
        !JSON.stringify(aNotifs.data).includes('secret hello from C'));
    const wrongUnlock = await req('POST', '/api/chat-locks/unlock', {
      token: A.token,
      body: { pin: '0000' },
    });
    check('lock: wrong PIN is refused (401)', wrongUnlock.status === 401);
    const unlockRes = await req('POST', '/api/chat-locks/unlock', {
      token: A.token,
      body: { pin: '1357' },
    });
    check('lock: correct PIN issues an unlock grant',
      unlockRes.status === 200 && !!unlockRes.data.unlockToken);
    const unlockHeaders = { 'x-unlock-token': unlockRes.data.unlockToken };
    const histUnlocked = await req('GET', `/api/messages/${lockConvId}`, {
      token: A.token,
      headers: unlockHeaders,
    });
    check('lock: history loads with the unlock grant and shows the message',
      histUnlocked.status === 200 &&
        (histUnlocked.data.messages || []).some((m) => m.content === 'secret hello from C'));
    const lockedList = await req('GET', '/api/chat-locks/conversations', {
      token: A.token,
      headers: unlockHeaders,
    });
    check('lock: locked list shows the chat after PIN entry',
      (lockedList.data.conversations || []).some((c) => c._id === lockConvId));
    const lockedListNoGrant = await req('GET', '/api/chat-locks/conversations', { token: A.token });
    check('lock: locked list itself requires the grant (423)', lockedListNoGrant.status === 423);
    const sockLockedSend = await emitAck(sockA, 'send_message', {
      conversationId: lockConvId,
      content: 'socket send while locked',
      clientMessageId: 'test-locked-sock',
    });
    check('lock: socket send into a locked chat is refused without socket unlock',
      sockLockedSend.ok === false);
    const sockUnlock = await emitAck(sockA, 'unlock_chats', { token: unlockRes.data.unlockToken });
    check('lock: socket accepts the unlock grant', sockUnlock.ok === true);
    const sockLockedSend2 = await emitAck(sockA, 'send_message', {
      conversationId: lockConvId,
      content: 'socket send after unlock',
      clientMessageId: 'test-locked-sock-2',
    });
    check('lock: socket send works after unlock', sockLockedSend2.ok === true);

    // Hidden chats (Module 21)
    const secretSet = await req('POST', '/api/chat-locks/secret', {
      token: A.token,
      body: { secretCode: 'open-sesame' },
    });
    check('hidden: secret code can be set', secretSet.status === 201);
    const hideChatRes = await req('POST', `/api/chat-locks/${lockConvId}/hide`, {
      token: A.token,
      body: { hidden: true },
    });
    check('hidden: locked chat can be marked hidden', hideChatRes.status === 200);
    const lockedListHidden = await req('GET', '/api/chat-locks/conversations', {
      token: A.token,
      headers: unlockHeaders,
    });
    check('hidden: hidden chat disappears even from the locked list',
      !(lockedListHidden.data.conversations || []).some((c) => c._id === lockConvId));
    const revealWrong = await req('POST', '/api/chat-locks/reveal', {
      token: A.token,
      body: { secretCode: 'wrong-code' },
    });
    check('hidden: wrong secret code is refused (401)', revealWrong.status === 401);
    const revealOk = await req('POST', '/api/chat-locks/reveal', {
      token: A.token,
      body: { secretCode: 'open-sesame' },
    });
    check('hidden: correct secret code reveals the hidden chat',
      revealOk.status === 200 &&
        (revealOk.data.conversations || []).some((c) => c._id === lockConvId));
    const removeLock = await req('DELETE', `/api/chat-locks/${lockConvId}`, {
      token: A.token,
      headers: unlockHeaders,
    });
    const aMainAfterUnlockAll = await req('GET', '/api/conversations', { token: A.token });
    const histAfterRemove = await req('GET', `/api/messages/${lockConvId}`, { token: A.token });
    check('lock: removing the lock restores the chat everywhere',
      removeLock.status === 200 &&
        (aMainAfterUnlockAll.data.conversations || []).some((c) => c._id === lockConvId) &&
        histAfterRemove.status === 200);

    // PIN change + rate limiting + password recovery (fresh user D)
    const dConvRes = await req('POST', '/api/conversations', {
      token: D.token,
      body: { type: 'private', participantId: A.id },
    });
    const dConvId = dConvRes.data.conversation._id;
    await req('POST', '/api/chat-locks/pin', { token: D.token, body: { pin: '9999' } });
    await req('POST', `/api/chat-locks/${dConvId}/lock`, { token: D.token });
    let lastWrongStatus = 0;
    for (let i = 0; i < 5; i += 1) {
      const wrong = await req('POST', '/api/chat-locks/unlock', {
        token: D.token,
        body: { pin: '1111' },
      });
      lastWrongStatus = wrong.status;
    }
    check('lock: repeated wrong PINs are refused (401)', lastWrongStatus === 401);
    const rateLimited = await req('POST', '/api/chat-locks/unlock', {
      token: D.token,
      body: { pin: '9999' },
    });
    check('lock: after 5 failed attempts even the correct PIN is rate-limited (429)',
      rateLimited.status === 429);
    const pinResetWrongPw = await req('POST', '/api/chat-locks/pin/reset', {
      token: D.token,
      body: { password: 'WrongPass1!' },
    });
    check('lock: PIN reset requires the account password (401)', pinResetWrongPw.status === 401);
    const pinReset = await req('POST', '/api/chat-locks/pin/reset', {
      token: D.token,
      body: { password: 'Password1!' },
    });
    const dStatusAfterReset = await req('GET', '/api/chat-locks/status', { token: D.token });
    check('lock: password-verified PIN reset clears the PIN',
      pinReset.status === 200 && dStatusAfterReset.data.hasPin === false);
    const dPinNew = await req('POST', '/api/chat-locks/pin', {
      token: D.token,
      body: { pin: '8888' },
    });
    const dUnlockNew = await req('POST', '/api/chat-locks/unlock', {
      token: D.token,
      body: { pin: '8888' },
    });
    check('lock: a fresh PIN works after recovery',
      dPinNew.status === 201 && dUnlockNew.status === 200);

    // PIN change flow (user A): wrong current refused, correct change works.
    const changeWrong = await req('POST', '/api/chat-locks/pin/change', {
      token: A.token,
      body: { currentPin: '0000', newPin: '2468' },
    });
    check('lock: change PIN with wrong current PIN is refused (401)', changeWrong.status === 401);
    const changeOk = await req('POST', '/api/chat-locks/pin/change', {
      token: A.token,
      body: { currentPin: '1357', newPin: '2468' },
    });
    const unlockNewPin = await req('POST', '/api/chat-locks/unlock', {
      token: A.token,
      body: { pin: '2468' },
    });
    check('lock: change PIN with correct current PIN works and the new PIN unlocks',
      changeOk.status === 200 && unlockNewPin.status === 200);

    // --- v3.0 Phase B: channels (Module 14) --------------------------------
    const channelRes = await req('POST', '/api/conversations', {
      token: A.token,
      body: {
        type: 'channel',
        groupName: 'Tech News Daily',
        groupImage: '',
        description: 'Daily tech headlines',
        visibility: 'public',
      },
    });
    check('channel: can be created with name, description and visibility',
      channelRes.status === 201 &&
        channelRes.data.conversation.type === 'channel' &&
        channelRes.data.conversation.description === 'Daily tech headlines' &&
        channelRes.data.conversation.myRole === 'admin');
    const channelId = channelRes.data.conversation._id;
    const channelPost = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: channelId, content: 'Welcome to the channel', clientMessageId: 'test-channel-1' },
    });
    check('channel: admin can post', channelPost.status === 201);
    const discoverAnon = await req('GET', '/api/channels?q=Tech');
    check('channel: discovery requires auth (401)', discoverAnon.status === 401);
    const discover = await req('GET', '/api/channels?q=Tech', { token: B.token });
    const discovered = (discover.data.channels || []).find((c) => c._id === channelId);
    check('channel: public channel is discoverable with follower count',
      !!discovered && discovered.followerCount === 1 && discovered.following === false);
    const followRes = await req('POST', `/api/conversations/${channelId}/follow`, { token: B.token });
    check('channel: follow joins as a follower',
      followRes.status === 201 && followRes.data.conversation.myRole === 'member');
    const followerPost = await req('POST', '/api/messages', {
      token: B.token,
      body: { conversationId: channelId, content: 'followers should not post', clientMessageId: 'test-channel-2' },
    });
    check('channel: follower cannot post (403)', followerPost.status === 403);
    const followerHistory = await req('GET', `/api/messages/${channelId}`, { token: B.token });
    check('channel: follower can read the channel history',
      followerHistory.status === 200 &&
        (followerHistory.data.messages || []).some((m) => m.content === 'Welcome to the channel'));
    const followerReact = await req('POST', `/api/messages/${channelPost.data.message._id}/reactions`, {
      token: B.token,
      body: { emoji: '👍' },
    });
    check('channel: follower can react to posts', followerReact.status === 200);
    const discoverAfter = await req('GET', '/api/channels?q=Tech', { token: C.token });
    const discoveredAfter = (discoverAfter.data.channels || []).find((c) => c._id === channelId);
    check('channel: follower count grows after a follow',
      !!discoveredAfter && discoveredAfter.followerCount === 2);
    const unfollowRes = await req('POST', `/api/conversations/${channelId}/unfollow`, { token: B.token });
    const historyAfterUnfollow = await req('GET', `/api/messages/${channelId}`, { token: B.token });
    check('channel: unfollow ends read access',
      unfollowRes.status === 200 && historyAfterUnfollow.status === 403);
    const privChannel = await req('POST', '/api/conversations', {
      token: A.token,
      body: { type: 'channel', groupName: 'Secret Club Channel', visibility: 'private' },
    });
    const discoverPriv = await req('GET', '/api/channels?q=Secret', { token: B.token });
    check('channel: private channels never appear in discovery',
      !(discoverPriv.data.channels || []).some((c) => c._id === privChannel.data.conversation._id));
    const followPriv = await req('POST', `/api/conversations/${privChannel.data.conversation._id}/follow`, {
      token: B.token,
    });
    check('channel: private channel cannot be followed by outsiders (403)', followPriv.status === 403);

    // --- v3.0 Phase B: communities (Module 14) -----------------------------
    const communityRes = await req('POST', '/api/communities', {
      token: A.token,
      body: {
        name: 'Study Circle',
        description: 'All our study groups in one place',
        groupIds: [richGroupId],
      },
    });
    check('community: created with a linked group and an announcement channel',
      communityRes.status === 201 &&
        communityRes.data.community.name === 'Study Circle' &&
        !!communityRes.data.community.announcementChannelId &&
        (communityRes.data.community.groups || []).some((g) => g._id === richGroupId));
    const community = communityRes.data.community;
    check('community: member list is derived from the linked groups',
      community.memberIds.includes(A.id) &&
        community.memberIds.includes(B.id) &&
        community.memberIds.includes(C.id));
    const bCommunities = await req('GET', '/api/communities', { token: B.token });
    check('community: a group member sees the community in their list',
      (bCommunities.data.communities || []).some((c) => c._id === community._id));
    const dCommunities = await req('GET', '/api/communities', { token: D.token });
    check('community: outsiders do not see the community',
      !(dCommunities.data.communities || []).some((c) => c._id === community._id));
    const announcePost = await req('POST', '/api/messages', {
      token: A.token,
      body: {
        conversationId: community.announcementChannelId,
        content: 'Exam week schedule is out',
        clientMessageId: 'test-community-announce',
      },
    });
    check('community: admin can post in the announcement channel', announcePost.status === 201);
    const announceRead = await req('GET', `/api/messages/${community.announcementChannelId}`, {
      token: B.token,
    });
    check('community: linked group members follow the announcement channel',
      announceRead.status === 200 &&
        (announceRead.data.messages || []).some((m) => m.content === 'Exam week schedule is out'));
    const announcePostByMember = await req('POST', '/api/messages', {
      token: B.token,
      body: {
        conversationId: community.announcementChannelId,
        content: 'members should not announce',
        clientMessageId: 'test-community-announce-2',
      },
    });
    check('community: non-admin members cannot post announcements (403)',
      announcePostByMember.status === 403);
    const secondGroup = await req('POST', '/api/conversations', {
      token: A.token,
      body: { type: 'group', groupName: 'Weekend Hikers', memberIds: [B.id] },
    });
    const linkByMember = await req('POST', `/api/communities/${community._id}/groups`, {
      token: B.token,
      body: { conversationId: secondGroup.data.conversation._id },
    });
    check('community: non-admin cannot link groups (403)', linkByMember.status === 403);
    const linkByAdmin = await req('POST', `/api/communities/${community._id}/groups`, {
      token: A.token,
      body: { conversationId: secondGroup.data.conversation._id },
    });
    check('community: admin can link another group',
      linkByAdmin.status === 200 &&
        (linkByAdmin.data.community.groups || []).length === 2);
    const unlinkRes = await req('DELETE', `/api/communities/${community._id}/groups/${secondGroup.data.conversation._id}`, {
      token: A.token,
    });
    check('community: admin can unlink a group',
      unlinkRes.status === 200 &&
        (unlinkRes.data.community.groups || []).length === 1);
    const dCommunityDetail = await req('GET', `/api/communities/${community._id}`, { token: D.token });
    check('community: detail is refused for outsiders (403)', dCommunityDetail.status === 403);

    // --- v3.0 Phase C: one-time location (Module 29) ----------------------
    const locMsg = await req('POST', '/api/messages', {
      token: A.token,
      body: {
        conversationId: convId,
        messageType: 'location',
        location: { latitude: 33.52, longitude: 73.09, label: 'Test Point' },
        clientMessageId: 'test-location-1',
      },
    });
    check('location: message created with coordinates stored',
      locMsg.status === 201 &&
        locMsg.data.message.messageType === 'location' &&
        Math.abs(locMsg.data.message.location.latitude - 33.52) < 1e-9 &&
        Math.abs(locMsg.data.message.location.longitude - 73.09) < 1e-9 &&
        locMsg.data.message.location.label === 'Test Point');
    const bLocHistory = await req('GET', `/api/messages/${convId}?limit=100`, { token: B.token });
    check('location: recipient history carries the pin',
      (bLocHistory.data.messages || []).some(
        (m) => m._id === locMsg.data.message._id && m.location && m.location.latitude === 33.52
      ));
    const badLoc = await req('POST', '/api/messages', {
      token: A.token,
      body: {
        conversationId: convId,
        messageType: 'location',
        location: { latitude: 123, longitude: 0 },
      },
    });
    check('location: out-of-range coordinates are rejected (400)', badLoc.status === 400);
    const forgedCall = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, messageType: 'call', content: 'fake call' },
    });
    check('location/calls: clients cannot forge call system messages (400)',
      forgedCall.status === 400);

    // --- v3.0 Phase C: live location (Module 29) --------------------------
    const liveStart = await req('POST', '/api/live-location/start', {
      token: A.token,
      body: {
        conversationId: convId,
        latitude: 33.5,
        longitude: 73.0,
        label: 'On my way',
        durationSec: 3600,
      },
    });
    check('live location: session starts active with a rendering message',
      liveStart.status === 201 &&
        liveStart.data.session.active === true &&
        liveStart.data.message.messageType === 'live_location' &&
        !!liveStart.data.session._id);
    const liveSessionId = liveStart.data.session._id;
    const liveByOther = await req('POST', `/api/live-location/${liveSessionId}/update`, {
      token: B.token,
      body: { latitude: 34.0, longitude: 74.0 },
    });
    check('live location: only the sharer can update (403 for others)',
      liveByOther.status === 403);
    const liveUpdate = await req('POST', `/api/live-location/${liveSessionId}/update`, {
      token: A.token,
      body: { latitude: 33.6, longitude: 73.2 },
    });
    check('live location: sharer position update succeeds',
      liveUpdate.status === 200 && liveUpdate.data.session.latitude === 33.6);
    const liveSeen = await req('GET', `/api/live-location/${liveSessionId}`, { token: B.token });
    check('live location: members read the latest position',
      liveSeen.status === 200 && liveSeen.data.session.latitude === 33.6);
    const sockLiveAck = await emitAck(sockA, 'live_location_update', {
      sessionId: liveSessionId,
      latitude: 33.7,
      longitude: 73.3,
    });
    check('live location: socket update path shares the same rules',
      !!sockLiveAck && sockLiveAck.ok === true);
    const liveStop = await req('POST', `/api/live-location/${liveSessionId}/stop`, {
      token: A.token,
    });
    check('live location: sharer can stop the session',
      liveStop.status === 200 && liveStop.data.session.active === false);
    const updateAfterStop = await req('POST', `/api/live-location/${liveSessionId}/update`, {
      token: A.token,
      body: { latitude: 33.8, longitude: 73.4 },
    });
    check('live location: updates after stop are rejected (400)',
      updateAfterStop.status === 400);
    const shortLive = await req('POST', '/api/live-location/start', {
      token: A.token,
      body: { conversationId: convId, latitude: 33.5, longitude: 73.0, durationSec: 1 },
    });
    await new Promise((r) => setTimeout(r, 1600));
    const updateAfterExpiry = await req(
      'POST',
      `/api/live-location/${shortLive.data.session._id}/update`,
      { token: A.token, body: { latitude: 33.9, longitude: 73.9 } }
    );
    check('live location: updates after expiry are rejected (400)',
      updateAfterExpiry.status === 400);

    // --- v3.0 Phase C: business profiles (Module 30) ----------------------
    const bizPatch = await req('PATCH', '/api/business/me', {
      token: C.token,
      body: {
        isBusiness: true,
        name: "Charlie's Tutoring",
        category: 'Education',
        description: 'Maths and physics tutoring',
        publicEmail: 'hi@charlies.test',
        publicPhone: '+1 555 0100',
        address: '1 Main Street',
        website: 'https://charlies.test',
        welcomeMessage: 'Welcome to Charlies!',
        verified: true, // must be ignored: owners cannot self-verify
      },
    });
    check('business: profile upgrade succeeds',
      bizPatch.status === 200 &&
        bizPatch.data.business.isBusiness === true &&
        bizPatch.data.business.name === "Charlie's Tutoring");
    check('business: owner cannot self-verify (verified stays false)',
      bizPatch.status === 200 && bizPatch.data.business.verified === false);
    const directory = await req('GET', '/api/business/directory?q=Charlie', { token: A.token });
    check('business: directory search finds the business by name',
      (directory.data.businesses || []).some(
        (b) => b.userId === C.id && b.name === "Charlie's Tutoring"
      ));
    const directoryByCat = await req('GET', '/api/business/directory?category=Education', {
      token: A.token,
    });
    check('business: directory filters by category',
      (directoryByCat.data.businesses || []).some((b) => b.userId === C.id));
    await req('PATCH', '/api/business/me', {
      token: C.token,
      body: { visibility: { address: 'nobody' } },
    });
    const publicPage = await req('GET', `/api/business/${C.id}`, { token: A.token });
    check('business: public page hides fields set to nobody, shows everyone fields',
      publicPage.status === 200 &&
        publicPage.data.business.address === undefined &&
        publicPage.data.business.publicEmail === 'hi@charlies.test' &&
        publicPage.data.business.verified === false);
    const ownBiz = await req('GET', '/api/business/me', { token: C.token });
    check('business: owner still sees their own private fields',
      ownBiz.data.business.address === '1 Main Street');

    const productRes = await req('POST', '/api/business/products', {
      token: C.token,
      body: { name: 'Algebra course', description: '12 lessons', price: 5000, currency: 'PKR' },
    });
    check('business: owner can add a product',
      productRes.status === 201 && productRes.data.product.name === 'Algebra course');
    const productId = productRes.data.product._id;
    const productEditByOther = await req('PATCH', `/api/business/products/${productId}`, {
      token: A.token,
      body: { price: 1 },
    });
    check('business: non-owner cannot edit products (403)', productEditByOther.status === 403);
    const productDeleteByOther = await req('DELETE', `/api/business/products/${productId}`, {
      token: A.token,
    });
    check('business: non-owner cannot delete products (403)', productDeleteByOther.status === 403);
    const productEdit = await req('PATCH', `/api/business/products/${productId}`, {
      token: C.token,
      body: { price: 4500 },
    });
    check('business: owner edits the product price',
      productEdit.status === 200 && productEdit.data.product.price === 4500);
    const publicProducts = await req('GET', `/api/business/${C.id}/products`, { token: B.token });
    check('business: public product list shows the catalogue',
      (publicProducts.data.products || []).some((p) => p._id === productId && p.price === 4500));

    const qrPut = await req('PUT', '/api/business/quick-replies', {
      token: C.token,
      body: { quickReplies: [{ title: 'Fees', text: 'Our fee is PKR 4500 per course.' }] },
    });
    const qrGet = await req('GET', '/api/business/quick-replies', { token: C.token });
    check('business: quick replies save and load',
      qrPut.status === 200 &&
        qrGet.data.quickReplies.length === 1 &&
        qrGet.data.quickReplies[0].title === 'Fees');

    const verifyByNonAdmin = await req('PATCH', `/api/admin/users/${C.id}/business-verified`, {
      token: C.token,
      body: { verified: true },
    });
    check('business: non-admin cannot use the verify endpoint (403)',
      verifyByNonAdmin.status === 403);
    const verifyByAdmin = await req('PATCH', `/api/admin/users/${C.id}/business-verified`, {
      token: ADMIN.token,
      body: { verified: true },
    });
    check('business: admin endpoint sets the verified badge',
      verifyByAdmin.status === 200 && verifyByAdmin.data.user.business.verified === true);
    const publicAfterVerify = await req('GET', `/api/business/${C.id}`, { token: A.token });
    check('business: public page shows the admin-granted badge',
      publicAfterVerify.data.business.verified === true);

    // --- v3.0 Phase C: welcome + away auto-messages (Module 30) -----------
    const allClosed = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      open: '09:00',
      close: '17:00',
      closed: true,
    }));
    await req('PATCH', '/api/business/me', {
      token: C.token,
      body: { awayMessage: 'We are closed right now.', hours: allClosed },
    });
    const bizConvRes = await req('POST', '/api/conversations', {
      token: B.token,
      body: { type: 'private', participantId: C.id },
    });
    const bizConvId = bizConvRes.data.conversation._id;
    await req('POST', '/api/messages', {
      token: B.token,
      body: { conversationId: bizConvId, content: 'Hi, I need tutoring', clientMessageId: 'test-biz-1' },
    });
    const bizHistory1 = await req('GET', `/api/messages/${bizConvId}?limit=50`, { token: B.token });
    const autos1 = (bizHistory1.data.messages || []).filter((m) => m.autoReply);
    check('business: welcome message auto-sent once on first contact',
      autos1.some(
        (m) => m.autoReply === 'welcome' && m.content === 'Welcome to Charlies!' &&
          (typeof m.senderId === 'object' ? m.senderId._id : m.senderId) === C.id
      ));
    check('business: away message auto-sent while closed (all days closed in test)',
      autos1.some((m) => m.autoReply === 'away' && m.content === 'We are closed right now.'));
    await req('POST', '/api/messages', {
      token: B.token,
      body: { conversationId: bizConvId, content: 'Anyone there?', clientMessageId: 'test-biz-2' },
    });
    const bizHistory2 = await req('GET', `/api/messages/${bizConvId}?limit=50`, { token: B.token });
    const autos2 = (bizHistory2.data.messages || []).filter((m) => m.autoReply);
    check('business: no repeat welcome/away on later messages (once guards hold)',
      autos2.length === autos1.length);
    // The business itself messaging must never trigger auto-replies (no loops).
    await req('POST', '/api/messages', {
      token: C.token,
      body: { conversationId: bizConvId, content: 'Thanks for writing!', clientMessageId: 'test-biz-3' },
    });
    const bizHistory3 = await req('GET', `/api/messages/${bizConvId}?limit=50`, { token: B.token });
    check('business: business-originated messages never trigger auto-replies',
      (bizHistory3.data.messages || []).filter((m) => m.autoReply).length === autos1.length);
    // Open the business around the clock: away must stop, welcome still fires
    // for a NEW first contact.
    const allOpen = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      open: '00:00',
      close: '23:59',
      closed: false,
    }));
    await req('PATCH', '/api/business/me', { token: C.token, body: { hours: allOpen } });
    const dBizConvRes = await req('POST', '/api/conversations', {
      token: D.token,
      body: { type: 'private', participantId: C.id },
    });
    const dBizConvId = dBizConvRes.data.conversation._id;
    await req('POST', '/api/messages', {
      token: D.token,
      body: { conversationId: dBizConvId, content: 'Hello!', clientMessageId: 'test-biz-4' },
    });
    const dHistory = await req('GET', `/api/messages/${dBizConvId}?limit=50`, { token: D.token });
    const dAutos = (dHistory.data.messages || []).filter((m) => m.autoReply);
    check('business: welcome fires for a new contact while open, away does not',
      dAutos.some((m) => m.autoReply === 'welcome') &&
        !dAutos.some((m) => m.autoReply === 'away'));

    // --- v3.0 Phase C: voice/video calls (Module 8) -------------------------
    const sockC = await connectSocket(C.token);
    const sockD = await connectSocket(D.token);
    const fakeOffer = { type: 'offer', sdp: 'v=0 fake-offer' };
    const strangerAck = await emitAck(sockD, 'call_invite', {
      conversationId: convId,
      callType: 'voice',
      offer: fakeOffer,
    });
    check('call: a stranger cannot signal into a conversation they are not part of',
      !!strangerAck && strangerAck.ok === false);
    const strangerAck2 = await emitAck(sockD, 'call_invite', {
      conversationId: lockConvId,
      callType: 'voice',
      offer: fakeOffer,
    });
    check('call: invites require membership even with a real conversation id',
      !!strangerAck2 && strangerAck2.ok === false);

    // Completed call: A -> B, B accepts, A ends.
    const incomingCallP = waitEvent(sockB, 'incoming_call', 8000);
    const inviteAck = await emitAck(sockA, 'call_invite', {
      conversationId: convId,
      callType: 'voice',
      offer: fakeOffer,
    });
    check('call: invite is accepted for members of a private conversation',
      !!inviteAck && inviteAck.ok === true && !!inviteAck.callId);
    const incomingCallEvt = await incomingCallP;
    check('call: callee receives the incoming call with caller identity',
      incomingCallEvt.callId === inviteAck.callId &&
        incomingCallEvt.caller._id === A.id &&
        incomingCallEvt.callType === 'voice');
    sockD.emit('call_accept', { callId: inviteAck.callId, answer: { type: 'answer', sdp: 'fake' } });
    await new Promise((r) => setTimeout(r, 250));
    const acceptedP = waitEvent(sockA, 'call_accepted', 8000);
    sockB.emit('call_accept', {
      callId: inviteAck.callId,
      answer: { type: 'answer', sdp: 'v=0 fake-answer' },
    });
    const accepted = await acceptedP;
    check('call: only the callee can answer; the answer is relayed to the caller',
      accepted.callId === inviteAck.callId && accepted.answer.sdp === 'v=0 fake-answer');
    await new Promise((r) => setTimeout(r, 400));
    sockA.emit('call_end', { callId: inviteAck.callId });
    await new Promise((r) => setTimeout(r, 400));
    const callsA = await req('GET', '/api/calls', { token: A.token });
    const completedCall = (callsA.data.calls || []).find((c) => c._id === inviteAck.callId);
    check('call: completed call is logged with duration + outgoing direction',
      !!completedCall &&
        completedCall.status === 'completed' &&
        completedCall.durationSec >= 0 &&
        completedCall.direction === 'outgoing');
    const bCallHistory = await req('GET', `/api/messages/${convId}?limit=100`, { token: B.token });
    check('call: a system message surfaces the call in the conversation',
      (bCallHistory.data.messages || []).some(
        (m) => m.messageType === 'call' && (m.content || '').includes('Voice call')
      ));

    // Declined call: A -> B, B rejects.
    const incoming2P = waitEvent(sockB, 'incoming_call', 8000);
    const invite2Ack = await emitAck(sockA, 'call_invite', {
      conversationId: convId,
      callType: 'video',
      offer: fakeOffer,
    });
    await incoming2P;
    sockB.emit('call_reject', { callId: invite2Ack.callId });
    await new Promise((r) => setTimeout(r, 400));
    const callsA2 = await req('GET', '/api/calls', { token: A.token });
    const declinedCall = (callsA2.data.calls || []).find((c) => c._id === invite2Ack.callId);
    check('call: declined call is logged as declined',
      !!declinedCall && declinedCall.status === 'declined' && declinedCall.type === 'video');

    // Missed call: A -> B, nobody answers; the ring timeout resolves it and
    // the callee gets a missed_call notification.
    const missedEndP = waitEvent(sockB, 'call_ended', 9000);
    const invite3Ack = await emitAck(sockA, 'call_invite', {
      conversationId: convId,
      callType: 'voice',
      offer: fakeOffer,
    });
    const missedEnd = await missedEndP;
    check('call: unanswered call resolves as missed after the ring timeout',
      missedEnd.callId === invite3Ack.callId && missedEnd.status === 'missed');
    const bNotifs = await req('GET', '/api/notifications', { token: B.token });
    check('call: missed call creates a missed_call notification for the callee',
      (bNotifs.data.notifications || []).some(
        (n) => n.type === 'missed_call' && n.conversationId === convId
      ));

    // Busy: while A and B are in a call, C calling B is logged declined/busy.
    const incoming4P = waitEvent(sockB, 'incoming_call', 8000);
    const invite4Ack = await emitAck(sockA, 'call_invite', {
      conversationId: convId,
      callType: 'voice',
      offer: fakeOffer,
    });
    await incoming4P;
    sockB.emit('call_accept', {
      callId: invite4Ack.callId,
      answer: { type: 'answer', sdp: 'v=0 fake-answer' },
    });
    await new Promise((r) => setTimeout(r, 300));
    const busyAck = await emitAck(sockC, 'call_invite', {
      conversationId: bizConvId,
      callType: 'voice',
      offer: fakeOffer,
    });
    check('call: calling a busy user is refused with a busy signal',
      !!busyAck && busyAck.ok === false && busyAck.busy === true);
    const callsC = await req('GET', '/api/calls', { token: C.token });
    check('call: the busy attempt is still logged (declined / busy)',
      (callsC.data.calls || []).some(
        (c) => c.conversationId === bizConvId && c.status === 'declined' && c.endReason === 'busy'
      ));
    sockA.emit('call_end', { callId: invite4Ack.callId });
    await new Promise((r) => setTimeout(r, 300));

    // =====================================================================
    // Phase D — calendar, documents & tasks, backup, 2FA/sessions, anti-spam
    // =====================================================================
    const cryptoD = require('crypto');

    // RFC 6238 TOTP, re-implemented here so the tests verify the server
    // against the spec rather than against its own helper.
    function testTotp(secretBase32, date = new Date()) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const clean = secretBase32.toUpperCase().replace(/=+$/, '');
      let bits = 0;
      let value = 0;
      const bytes = [];
      for (const ch of clean) {
        value = (value << 5) | alphabet.indexOf(ch);
        bits += 5;
        if (bits >= 8) {
          bytes.push((value >>> (bits - 8)) & 0xff);
          bits -= 8;
        }
      }
      const key = Buffer.from(bytes);
      const counter = Math.floor(date.getTime() / 1000 / 30);
      const msg = Buffer.alloc(8);
      msg.writeBigUInt64BE(BigInt(counter));
      const hmac = cryptoD.createHmac('sha1', key).update(msg).digest();
      const offset = hmac[hmac.length - 1] & 0x0f;
      const binary =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
      return String(binary % 1000000).padStart(6, '0');
    }

    async function registerD(username, email) {
      const res = await req('POST', '/api/auth/register', {
        body: { username, email, password: 'Password1!' },
      });
      return { token: res.data.accessToken, id: res.data.user._id, email };
    }

    async function loginRawD(email, password, ua) {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ua ? { 'User-Agent': ua } : {}),
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      return {
        status: res.status,
        data,
        cookie: (res.headers.get('set-cookie') || '').split(';')[0],
      };
    }

    async function refreshRawD(cookie) {
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    }

    async function apiRawD(method, url, { token, cookie, ua } = {}) {
      const res = await fetch(`${BASE}${url}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(ua ? { 'User-Agent': ua } : {}),
        },
      });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    }

    // --- Calendar & meetings (module 31) ------------------------------------
    const evA = await registerD('eventa', 'eventa@test.dev');
    const evB = await registerD('eventb', 'eventb@test.dev');
    const evS = await registerD('eventstranger', 'eventstranger@test.dev');
    check('Phase D users registered', !!evA.token && !!evB.token && !!evS.token);
    await req('POST', '/api/conversations', {
      token: evA.token,
      body: { type: 'private', participantId: evB.id },
    });

    const tomorrow = new Date(Date.now() + 24 * 3600e3);
    const tomorrowEnd = new Date(tomorrow.getTime() + 3600e3);
    const badInvite = await req('POST', '/api/events', {
      token: evA.token,
      body: {
        title: 'Stranger party',
        startAt: tomorrow.toISOString(),
        endAt: tomorrowEnd.toISOString(),
        timezone: 'Asia/Karachi',
        inviteeIds: [evS.id],
      },
    });
    check('events: inviting someone you share no conversation with is refused (400)',
      badInvite.status === 400);

    const ev1 = await req('POST', '/api/events', {
      token: evA.token,
      body: {
        title: 'Project sync',
        description: 'Weekly sync',
        startAt: tomorrow.toISOString(),
        endAt: tomorrowEnd.toISOString(),
        timezone: 'Asia/Karachi',
        location: 'Office',
        reminderMinutes: [15],
        inviteeIds: [evB.id],
      },
    });
    check('events: creator can create an event and invite a contact',
      ev1.status === 201 &&
        ev1.data.event.attendees.length === 1 &&
        ev1.data.event.attendees[0].status === 'invited');
    const ev1Id = ev1.data.event._id;

    const evPeek = await req('GET', `/api/events/${ev1Id}`, { token: evS.token });
    check('events: a non-invitee cannot read the event (403)', evPeek.status === 403);

    const evReadOwn = await req('GET', `/api/events/${ev1Id}`, { token: evA.token });
    check('events: the creator can read their own event',
      evReadOwn.status === 200 && evReadOwn.data.event._id === ev1Id);
    const evReadInvitee = await req('GET', `/api/events/${ev1Id}`, { token: evB.token });
    check('events: an invitee can read the event', evReadInvitee.status === 200);

    const evAccept = await req('POST', `/api/events/${ev1Id}/respond`, {
      token: evB.token,
      body: { status: 'accepted' },
    });
    check('events: invitee can accept',
      evAccept.status === 200 &&
        evAccept.data.event.attendees.find((a) => (a.user._id || a.user) === evB.id)?.status === 'accepted');

    const ev2 = await req('POST', '/api/events', {
      token: evA.token,
      body: {
        title: 'Maybe meeting',
        startAt: tomorrow.toISOString(),
        endAt: tomorrowEnd.toISOString(),
        timezone: 'UTC',
        inviteeIds: [evB.id],
      },
    });
    const evDecline = await req('POST', `/api/events/${ev2.data.event._id}/respond`, {
      token: evB.token,
      body: { status: 'declined' },
    });
    check('events: invitee can decline',
      evDecline.status === 200 &&
        evDecline.data.event.attendees.find((a) => (a.user._id || a.user) === evB.id)?.status === 'declined');

    const evStrangerRespond = await req('POST', `/api/events/${ev1Id}/respond`, {
      token: evS.token,
      body: { status: 'accepted' },
    });
    check('events: a non-invitee cannot respond (403)', evStrangerRespond.status === 403);

    const evUpcoming = await req('GET', '/api/events?upcoming=true&limit=3', { token: evA.token });
    check('events: dashboard upcoming-events endpoint returns the next events',
      evUpcoming.status === 200 && (evUpcoming.data.events || []).some((e) => e._id === ev1Id));

    // Reminder: an event starting in 14 minutes with a 15-minute reminder
    // is already due; the checker (300 ms interval in tests) must turn it
    // into a notification for creator + invitee. Poll instead of sleeping.
    const soonStart = new Date(Date.now() + 14 * 60e3);
    const evReminder = await req('POST', '/api/events', {
      token: evA.token,
      body: {
        title: 'Reminder check event',
        startAt: soonStart.toISOString(),
        endAt: new Date(soonStart.getTime() + 3600e3).toISOString(),
        timezone: 'UTC',
        reminderMinutes: [15],
        inviteeIds: [evB.id],
      },
    });
    check('events: reminder event created', evReminder.status === 201);
    let reminderNotif = null;
    for (let i = 0; i < 20 && !reminderNotif; i += 1) {
      const notifs = await req('GET', '/api/notifications', { token: evB.token });
      reminderNotif = (notifs.data.notifications || []).find(
        (n) => n.type === 'event_reminder' && n.eventId === evReminder.data.event._id
      );
      if (!reminderNotif) await new Promise((r) => setTimeout(r, 500));
    }
    check('events: the reminder checker notifies invitees when the reminder time passes',
      !!reminderNotif && /Reminder check event/.test(reminderNotif.text || ''));

    // --- Documents & tasks (module 32) ---------------------------------------
    const folderRes = await req('POST', '/api/docs/folders', {
      token: evA.token,
      body: { name: 'Project D' },
    });
    check('docs: owner creates a folder', folderRes.status === 201);
    const folderId = folderRes.data.folder._id;

    const formD = new FormData();
    formD.append('file', new Blob(['hello docs phase d'], { type: 'text/plain' }), 'hello.txt');
    const uploadRes = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${evA.token}` },
      body: formD,
    });
    const uploadData = await uploadRes.json();
    check('docs: file uploads through the existing pipeline', uploadRes.status === 201 && !!uploadData.url);
    const fileRes = await req('POST', `/api/docs/folders/${folderId}/files`, {
      token: evA.token,
      body: { name: 'hello.txt', url: uploadData.url, size: 18, mimeType: 'text/plain' },
    });
    check('docs: file registers into the folder', fileRes.status === 201);
    const docFileId = fileRes.data.file._id;

    const strangerFolder = await req('GET', `/api/docs/folders/${folderId}`, { token: evS.token });
    check('docs: a stranger cannot open the folder (403)', strangerFolder.status === 403);
    const strangerDownload = await apiRawD('GET', `/api/docs/files/${docFileId}/download`, { token: evS.token });
    check('docs: a stranger cannot download a folder file (403)', strangerDownload.status === 403);

    const shareRes = await req('POST', `/api/docs/folders/${folderId}/share`, {
      token: evA.token,
      body: { userIds: [evB.id] },
    });
    check('docs: owner shares the folder with a user', shareRes.status === 200);

    const sharedFolder = await req('GET', `/api/docs/folders/${folderId}`, { token: evB.token });
    check('docs: the shared user can read the folder and its files',
      sharedFolder.status === 200 && (sharedFolder.data.files || []).length === 1);
    const downloadRes = await fetch(`${BASE}/api/docs/files/${docFileId}/download`, {
      headers: { Authorization: `Bearer ${evB.token}` },
    });
    const downloadText = await downloadRes.text();
    check('docs: the shared user can download the file bytes',
      downloadRes.status === 200 && downloadText.includes('hello docs phase d'));

    const noteRes = await req('POST', `/api/docs/folders/${folderId}/notes`, {
      token: evB.token,
      body: { title: 'Shared note', content: 'first draft' },
    });
    check('docs: a shared editor can add a note', noteRes.status === 201);
    const noteId = noteRes.data.note._id;
    const strangerNoteEdit = await req('PATCH', `/api/docs/notes/${noteId}`, {
      token: evS.token,
      body: { content: 'vandalised' },
    });
    check('docs: a stranger cannot edit a note (403)', strangerNoteEdit.status === 403);
    const noteEdit = await req('PATCH', `/api/docs/notes/${noteId}`, {
      token: evB.token,
      body: { content: 'second draft' },
    });
    check('docs: a shared editor can edit a note',
      noteEdit.status === 200 && noteEdit.data.note.content === 'second draft');

    const listRes = await req('POST', '/api/docs/task-lists', {
      token: evA.token,
      body: { title: 'D Tasks', folderId },
    });
    check('docs: task list created inside the folder', listRes.status === 201);
    const listId = listRes.data.taskList._id;

    const badAssign = await req('POST', `/api/docs/task-lists/${listId}/tasks`, {
      token: evA.token,
      body: { title: 'Stranger task', assigneeId: evS.id },
    });
    check('docs: assigning someone without list access is refused (400)', badAssign.status === 400);

    const taskRes = await req('POST', `/api/docs/task-lists/${listId}/tasks`, {
      token: evA.token,
      body: { title: 'Write the docs', assigneeId: evB.id },
    });
    check('docs: owner adds a task assigned to a shared user', taskRes.status === 201);
    const taskId = taskRes.data.task._id;

    const myTasksBefore = await req('GET', '/api/docs/my-tasks', { token: evB.token });
    check('docs: my-tasks shows the open assignment',
      (myTasksBefore.data.tasks || []).some((t) => t._id === taskId));

    const strangerTaskEdit = await req('PATCH', `/api/docs/tasks/${taskId}`, {
      token: evS.token,
      body: { status: 'done' },
    });
    check('docs: a stranger cannot change a task (403)', strangerTaskEdit.status === 403);

    const taskProgress = await req('PATCH', `/api/docs/tasks/${taskId}`, {
      token: evB.token,
      body: { status: 'in-progress' },
    });
    check('docs: the assignee can move the task to in-progress',
      taskProgress.status === 200 && taskProgress.data.task.status === 'in-progress');
    const taskDone = await req('PATCH', `/api/docs/tasks/${taskId}`, {
      token: evB.token,
      body: { status: 'done' },
    });
    check('docs: the assignee can complete the task',
      taskDone.status === 200 && taskDone.data.task.status === 'done');
    const myTasksAfter = await req('GET', '/api/docs/my-tasks', { token: evB.token });
    check('docs: completed tasks leave my-tasks',
      !(myTasksAfter.data.tasks || []).some((t) => t._id === taskId));

    // --- Backup: export (module 23) ------------------------------------------
    const exportRes = await fetch(`${BASE}/api/users/me/export`, {
      headers: { Authorization: `Bearer ${evA.token}` },
    });
    const exportText = await exportRes.text();
    const exportJson = JSON.parse(exportText);
    check('export: downloads as a JSON attachment with the caller\'s data',
      exportRes.status === 200 &&
        (exportRes.headers.get('content-disposition') || '').includes('attachment') &&
        exportJson.kind === 'connectx-export' &&
        exportJson.profile.email === 'eventa@test.dev' &&
        Array.isArray(exportJson.messages) &&
        (exportJson.folders || []).some((f) => f.name === 'Project D'));
    const secretNeedles = [
      '"password"',
      'chatLockPinHash',
      'secretCodeHash',
      'refreshTokens',
      'resetPasswordTokenHash',
      'totpSecretEncrypted',
      'totpBackupCodeHashes',
      '$2a$',
      '$2b$',
    ];
    check('export: contains NO password/PIN hashes, tokens or 2FA secrets',
      secretNeedles.every((needle) => !exportText.includes(needle)),
      `leaked: ${secretNeedles.filter((n) => exportText.includes(n)).join(', ')}`);

    // --- Backup: import merges without deleting ------------------------------
    const imB = await registerD('importb', 'importb@test.dev');
    await req('POST', '/api/docs/folders', { token: imB.token, body: { name: 'B Own Folder' } });
    const import1 = await req('POST', '/api/users/me/import', { token: imB.token, body: exportJson });
    check('import: restores folders/notes/tasks and preferences into another account',
      import1.status === 200 &&
        import1.data.summary.imported.folders >= 1 &&
        import1.data.summary.preferencesRestored === true &&
        import1.data.summary.messagesRestored === 0);
    const imBFolders = await req('GET', '/api/docs/folders', { token: imB.token });
    const imBNames = (imBFolders.data.folders || []).map((f) => f.name);
    check('import: merge keeps existing data (own folder survives)',
      imBNames.includes('Project D') && imBNames.includes('B Own Folder'));
    const import2 = await req('POST', '/api/users/me/import', { token: imB.token, body: exportJson });
    const imBFolders2 = await req('GET', '/api/docs/folders', { token: imB.token });
    check('import: re-importing skips duplicates instead of duplicating',
      import2.status === 200 &&
        import2.data.summary.imported.folders === 0 &&
        import2.data.summary.skipped >= 1 &&
        (imBFolders2.data.folders || []).filter((f) => f.name === 'Project D').length === 1);
    const badImport = await req('POST', '/api/users/me/import', {
      token: imB.token,
      body: { hello: 'world' },
    });
    check('import: a non-export payload is refused (400)', badImport.status === 400);

    const eventImportPayload = {
      kind: 'connectx-export',
      version: 1,
      events: [
        {
          title: 'Imported Event X',
          startAt: tomorrow.toISOString(),
          endAt: tomorrowEnd.toISOString(),
          timezone: 'UTC',
          creator: evA.id,
        },
      ],
    };
    const eventImport = await req('POST', '/api/users/me/import', { token: evA.token, body: eventImportPayload });
    const evListAfterImport = await req('GET', '/api/events?limit=200', { token: evA.token });
    check('import: restores the caller\'s own events',
      eventImport.status === 200 &&
        eventImport.data.summary.imported.events === 1 &&
        (evListAfterImport.data.events || []).some((e) => e.title === 'Imported Event X'));

    // --- Account flows: deactivation/reactivation ------------------------------
    const acU = await registerD('accountu', 'accountu@test.dev');
    const deactivate = await req('POST', '/api/auth/deactivate', { token: acU.token });
    check('account: deactivation works', deactivate.status === 200);
    const deactivatedLogin = await req('POST', '/api/auth/login', {
      body: { email: 'accountu@test.dev', password: 'Password1!' },
    });
    check('account: a deactivated account cannot log in (401)', deactivatedLogin.status === 401);
    const badReactivate = await req('POST', '/api/auth/reactivate', {
      body: { email: 'accountu@test.dev', password: 'WrongPassword9' },
    });
    check('account: reactivation with a wrong password is refused (401)', badReactivate.status === 401);
    const reactivate = await req('POST', '/api/auth/reactivate', {
      body: { email: 'accountu@test.dev', password: 'Password1!' },
    });
    check('account: the owner can reactivate with their password',
      reactivate.status === 200 && !!reactivate.data.accessToken);
    const reactivatedLogin = await req('POST', '/api/auth/login', {
      body: { email: 'accountu@test.dev', password: 'Password1!' },
    });
    check('account: login works again after reactivation', reactivatedLogin.status === 200);

    // --- 2FA full flow (module 22) --------------------------------------------
    const tfU = await registerD('twofau', 'twofau@test.dev');
    const setup = await req('POST', '/api/security/2fa/setup', { token: tfU.token });
    check('2fa: setup returns a secret + otpauth URL once',
      setup.status === 200 &&
        typeof setup.data.secret === 'string' &&
        setup.data.secret.length >= 16 &&
        (setup.data.otpauthUrl || '').startsWith('otpauth://totp/'));
    const tfSecret = setup.data.secret;
    const wrongCode = testTotp(tfSecret) === '000000' ? '111111' : '000000';
    const confirmWrong = await req('POST', '/api/security/2fa/confirm', {
      token: tfU.token,
      body: { code: wrongCode },
    });
    check('2fa: a wrong code cannot confirm setup (401)', confirmWrong.status === 401);
    const confirm = await req('POST', '/api/security/2fa/confirm', {
      token: tfU.token,
      body: { code: testTotp(tfSecret) },
    });
    check('2fa: the right code enables 2FA and returns 8 one-time backup codes',
      confirm.status === 200 &&
        confirm.data.enabled === true &&
        Array.isArray(confirm.data.backupCodes) &&
        confirm.data.backupCodes.length === 8);
    const backupCodes = confirm.data.backupCodes;

    const meAfter2fa = await req('GET', '/api/users/me', { token: tfU.token });
    check('2fa: the secret is never returned by the API after setup',
      !JSON.stringify(meAfter2fa.data).includes(tfSecret));

    const challenge1 = await loginRawD('twofau@test.dev', 'Password1!');
    check('2fa: login now stops at a code challenge (no access token yet)',
      challenge1.status === 200 &&
        challenge1.data.twoFactorRequired === true &&
        !!challenge1.data.challengeToken &&
        !challenge1.data.accessToken);
    const badCode = await req('POST', '/api/auth/login/2fa', {
      body: { challengeToken: challenge1.data.challengeToken, code: wrongCode },
    });
    check('2fa: a wrong login code is refused (401)', badCode.status === 401);
    const goodCode = await req('POST', '/api/auth/login/2fa', {
      body: { challengeToken: challenge1.data.challengeToken, code: testTotp(tfSecret) },
    });
    check('2fa: the right login code completes sign-in',
      goodCode.status === 200 && !!goodCode.data.accessToken);
    const tfToken = goodCode.data.accessToken;

    const challenge2 = await loginRawD('twofau@test.dev', 'Password1!');
    const backupLogin = await req('POST', '/api/auth/login/2fa', {
      body: { challengeToken: challenge2.data.challengeToken, code: backupCodes[0] },
    });
    check('2fa: a backup code signs in', backupLogin.status === 200 && !!backupLogin.data.accessToken);
    const challenge3 = await loginRawD('twofau@test.dev', 'Password1!');
    const backupReuse = await req('POST', '/api/auth/login/2fa', {
      body: { challengeToken: challenge3.data.challengeToken, code: backupCodes[0] },
    });
    check('2fa: a backup code cannot be used twice (401)', backupReuse.status === 401);
    const challenge4 = await loginRawD('twofau@test.dev', 'Password1!');
    const backupSecond = await req('POST', '/api/auth/login/2fa', {
      body: { challengeToken: challenge4.data.challengeToken, code: backupCodes[1] },
    });
    check('2fa: the next backup code still works', backupSecond.status === 200);

    const disable = await req('POST', '/api/security/2fa/disable', {
      token: tfToken,
      body: { password: 'Password1!', code: testTotp(tfSecret) },
    });
    check('2fa: disable requires password + code and turns 2FA off',
      disable.status === 200 && disable.data.enabled === false);
    const plainLogin = await loginRawD('twofau@test.dev', 'Password1!');
    check('2fa: after disabling, login needs no code',
      plainLogin.status === 200 && !!plainLogin.data.accessToken && !plainLogin.data.twoFactorRequired);

    // 2FA rate limit: five wrong codes lock verification; even the right
    // code is then refused with 429 until the lockout passes.
    const tfR = await registerD('twofaratelimit', 'twofaratelimit@test.dev');
    const setupR = await req('POST', '/api/security/2fa/setup', { token: tfR.token });
    await req('POST', '/api/security/2fa/confirm', {
      token: tfR.token,
      body: { code: testTotp(setupR.data.secret) },
    });
    let tfLastWrongStatus = 0;
    for (let i = 0; i < 5; i += 1) {
      const ch = await loginRawD('twofaratelimit@test.dev', 'Password1!');
      const wrong = await req('POST', '/api/auth/login/2fa', {
        body: {
          challengeToken: ch.data.challengeToken,
          code: testTotp(setupR.data.secret) === '000000' ? '111111' : '000000',
        },
      });
      tfLastWrongStatus = wrong.status;
    }
    check('2fa: wrong codes are refused while under the attempt limit', tfLastWrongStatus === 401);
    const chLocked = await loginRawD('twofaratelimit@test.dev', 'Password1!');
    const lockedAttempt = await req('POST', '/api/auth/login/2fa', {
      body: { challengeToken: chLocked.data.challengeToken, code: testTotp(setupR.data.secret) },
    });
    check('2fa: after 5 wrong codes, verification locks out with 429 (even for the right code)',
      lockedAttempt.status === 429);

    // --- Sessions + login history (module 22) ---------------------------------
    const regSsRes = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Session-Zero' },
      body: JSON.stringify({ username: 'sessionu', email: 'sessionu@test.dev', password: 'Password1!' }),
    });
    const regSsData = await regSsRes.json();
    const ssCookie0 = (regSsRes.headers.get('set-cookie') || '').split(';')[0];
    check('sessions: registration creates the first session', regSsRes.status === 201 && !!ssCookie0);
    const ssLogin1 = await loginRawD('sessionu@test.dev', 'Password1!', 'Session-One');
    const ssLogin2 = await loginRawD('sessionu@test.dev', 'Password1!', 'Session-Two');
    const ssList = await apiRawD('GET', '/api/security/sessions', {
      token: ssLogin1.data.accessToken,
      cookie: ssLogin1.cookie,
    });
    check('sessions: list shows all sessions with exactly one marked current',
      ssList.status === 200 &&
        (ssList.data.sessions || []).length >= 3 &&
        (ssList.data.sessions || []).filter((s) => s.current).length === 1);
    const oldest = (ssList.data.sessions || [])
      .filter((s) => !s.current)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    const revokeOne = await apiRawD('DELETE', `/api/security/sessions/${oldest.sessionId}`, {
      token: ssLogin1.data.accessToken,
      cookie: ssLogin1.cookie,
    });
    check('sessions: revoking a session succeeds', revokeOne.status === 200);
    const refreshRevoked = await refreshRawD(ssCookie0);
    check('sessions: a revoked session\'s refresh token is invalidated (401)',
      refreshRevoked.status === 401);
    const revokeOthers = await fetch(`${BASE}/api/security/sessions/revoke-others`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ssLogin2.data.accessToken}`,
        Cookie: ssLogin2.cookie,
      },
    });
    const revokeOthersData = await revokeOthers.json();
    check('sessions: revoke-others keeps only the current session',
      revokeOthers.status === 200 && (revokeOthersData.sessions || []).length === 1);
    const refreshKicked = await refreshRawD(ssLogin1.cookie);
    check('sessions: the kicked session can no longer refresh (401)', refreshKicked.status === 401);
    const refreshKept = await refreshRawD(ssLogin2.cookie);
    check('sessions: the current session still refreshes', refreshKept.status === 200);
    const history = await apiRawD('GET', '/api/security/login-history', {
      token: ssLogin2.data.accessToken,
    });
    check('sessions: login history records the sign-ins',
      history.status === 200 &&
        (history.data.events || []).filter((e) => e.success).length >= 3);

    // --- New-device sign-in notification (module 22) ---------------------------
    const ndU = await registerD('newdeviceu', 'newdeviceu@test.dev');
    const ndLogin1 = await loginRawD('newdeviceu@test.dev', 'Password1!', 'Device-One');
    const ndNotifs1 = await req('GET', '/api/notifications', { token: ndLogin1.data.accessToken });
    const securityCount1 = (ndNotifs1.data.notifications || []).filter((n) => n.type === 'security').length;
    check('security: signing in from a new device creates a security notification', securityCount1 >= 1);
    await loginRawD('newdeviceu@test.dev', 'Password1!', 'Device-One');
    const ndNotifs2 = await req('GET', '/api/notifications', { token: ndLogin1.data.accessToken });
    const securityCount2 = (ndNotifs2.data.notifications || []).filter((n) => n.type === 'security').length;
    check('security: the same device signing in again does not re-notify', securityCount2 === securityCount1);
    await loginRawD('newdeviceu@test.dev', 'Password1!', 'Device-Two');
    const ndNotifs3 = await req('GET', '/api/notifications', { token: ndLogin1.data.accessToken });
    const securityCount3 = (ndNotifs3.data.notifications || []).filter((n) => n.type === 'security').length;
    check('security: a second new device notifies again', securityCount3 === securityCount1 + 1);

    // --- Report-based auto-flag (module 24) ------------------------------------
    const rpT = await registerD('reporttarget', 'reporttarget@test.dev');
    const rp1 = await registerD('reporter1', 'reporter1@test.dev');
    const rp2 = await registerD('reporter2', 'reporter2@test.dev');
    const rp3 = await registerD('reporter3', 'reporter3@test.dev');
    async function reportTarget(reporter) {
      return req('POST', '/api/reports', {
        token: reporter.token,
        body: { reportedUser: rpT.id, reason: 'Spam reports for the auto-flag test' },
      });
    }
    async function targetFlagged() {
      const users = await req('GET', '/api/admin/users', { token: ADMIN.token });
      const found = (users.data.users || []).find((u) => u._id === rpT.id);
      return found ? found.spamFlagged : undefined;
    }
    await reportTarget(rp1);
    check('anti-spam: one report does not flag the account', (await targetFlagged()) !== true);
    await reportTarget(rp2);
    check('anti-spam: two reports from distinct users do not flag yet', (await targetFlagged()) !== true);
    await reportTarget(rp3);
    check('anti-spam: the third distinct report auto-flags the account for admins',
      (await targetFlagged()) === true);

    // --- Link safety flags (module 24) ------------------------------------------
    const linkMsg1 = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'check https://bit.ly/abc123 please', clientMessageId: 'link-flag-1' },
    });
    check('links: a shortened link is flagged with its bare domain',
      linkMsg1.status === 201 &&
        (linkMsg1.data.message.linkFlags || []).some(
          (l) => l.domain === 'bit.ly' && l.flagged === true && l.reasons.includes('url-shortener')
        ));
    const linkMsg2 = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'read https://example.com/guide today', clientMessageId: 'link-flag-2' },
    });
    check('links: an ordinary link is recorded unflagged with its domain visible',
      linkMsg2.status === 201 &&
        (linkMsg2.data.message.linkFlags || []).length === 1 &&
        linkMsg2.data.message.linkFlags[0].domain === 'example.com' &&
        linkMsg2.data.message.linkFlags[0].flagged === false);
    const linkMsg3 = await req('POST', '/api/messages', {
      token: A.token,
      body: { conversationId: convId, content: 'go https://xn--80ak6aa92e.com/ now', clientMessageId: 'link-flag-3' },
    });
    check('links: a punycode domain is flagged',
      linkMsg3.status === 201 &&
        (linkMsg3.data.message.linkFlags || []).some(
          (l) => l.flagged === true && l.reasons.includes('punycode-domain')
        ));

    // --- Contacts discovery (WhatsApp-style) ----------------------------------
    // B publishes a phone number on the contact card as "everyone".
    await req('PATCH', '/api/users/me/contact-card', {
      token: B.token,
      body: { fields: { phone: '+92 300 1112223' }, visibility: { phone: 'everyone' } },
    });
    const discByEmail = await req('POST', '/api/users/discover', {
      token: A.token,
      body: { emails: ['  BILAL@test.dev '], phones: [] },
    });
    check('discover: email match returns the user (case/space-insensitive)',
      discByEmail.status === 200 && (discByEmail.data.users || []).some((u) => u._id === B.id));
    const discRaw = JSON.stringify(discByEmail.data);
    check('discover: the response contains no email, phone or contact-card data',
      !discRaw.includes('bilal@test.dev') &&
        !discRaw.includes('3001112223') &&
        !discRaw.includes('300 1112223') &&
        !discRaw.includes('contactCard'));
    const discByPhone = await req('POST', '/api/users/discover', {
      token: A.token,
      body: { emails: [], phones: ['03001112223'] }, // local format of the same number
    });
    check('discover: phone matches across local/international formats when visibility is everyone',
      discByPhone.status === 200 && (discByPhone.data.users || []).some((u) => u._id === B.id));
    await req('PATCH', '/api/users/me/contact-card', {
      token: B.token,
      body: { visibility: { phone: 'contacts' } },
    });
    const discPhoneContacts = await req('POST', '/api/users/discover', {
      token: A.token,
      body: { emails: [], phones: ['03001112223'] },
    });
    check('discover: phone does NOT match when visibility is contacts',
      discPhoneContacts.status === 200 &&
        !(discPhoneContacts.data.users || []).some((u) => u._id === B.id));
    await req('PATCH', '/api/users/me/contact-card', {
      token: B.token,
      body: { visibility: { phone: 'nobody' } },
    });
    const discPhoneNobody = await req('POST', '/api/users/discover', {
      token: A.token,
      body: { emails: [], phones: ['+923001112223'] },
    });
    check('discover: phone does NOT match when visibility is nobody',
      discPhoneNobody.status === 200 &&
        !(discPhoneNobody.data.users || []).some((u) => u._id === B.id));
    const discSelf = await req('POST', '/api/users/discover', {
      token: A.token,
      body: { emails: ['ahmad@test.dev'], phones: [] },
    });
    check('discover: a user never matches themselves',
      discSelf.status === 200 && !(discSelf.data.users || []).some((u) => u._id === A.id));

    // --- Reels ------------------------------------------------------------------
    const prefSet = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { reelInterests: ['Tech', 'Funny'] },
    });
    check('reels prefs: reelInterests saved through preferences',
      prefSet.status === 200 &&
        JSON.stringify(prefSet.data.preferences.reelInterests) === JSON.stringify(['Tech', 'Funny']));
    const prefGet = await req('GET', '/api/users/me/preferences', { token: A.token });
    check('reels prefs: reelInterests round-trips on read',
      JSON.stringify(prefGet.data.preferences.reelInterests) === JSON.stringify(['Tech', 'Funny']));
    const rlPrefBad = await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { reelInterests: ['NotARealInterest'] },
    });
    check('reels prefs: an unknown interest is rejected (400)', rlPrefBad.status === 400);
    // Narrow A to Tech only, for the feed-ranking check below.
    await req('PATCH', '/api/users/me/preferences', {
      token: A.token,
      body: { reelInterests: ['Tech'] },
    });

    const reelForm = new FormData();
    reelForm.append('file', new Blob([Buffer.from('fake-reel-bytes')], { type: 'video/mp4' }), 'reel.mp4');
    const reelUp = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${B.token}` },
      body: reelForm,
    });
    const reelUpData = await reelUp.json().catch(() => ({}));
    check('reels: clip uploads through the existing video pipeline',
      reelUp.status === 201 && reelUpData.messageType === 'video' && !!reelUpData.url);

    const badReel = await req('POST', '/api/reels', {
      token: B.token,
      body: { videoUrl: reelUpData.url, caption: 'nope', interest: 'NotARealInterest' },
    });
    check('reels: creating with an unknown interest is rejected (400)', badReel.status === 400);

    // The Tech reel is created FIRST (older) and the Funny reel second
    // (newer): for A (interests: Tech) the interest tier must outrank recency.
    const techReel = await req('POST', '/api/reels', {
      token: B.token,
      body: { videoUrl: reelUpData.url, caption: 'Tech talk', interest: 'Tech' },
    });
    check('reels: create succeeds', techReel.status === 201 && !!techReel.data.reel._id);
    const funnyReel = await req('POST', '/api/reels', {
      token: B.token,
      body: { videoUrl: reelUpData.url, caption: 'Funny clip', interest: 'Funny' },
    });
    const rlFeedA = await req('GET', '/api/reels/feed', { token: A.token });
    check('reels: interest-matched reels rank before newer non-matched ones',
      rlFeedA.status === 200 &&
        (rlFeedA.data.reels || []).length >= 2 &&
        rlFeedA.data.reels[0]._id === techReel.data.reel._id &&
        rlFeedA.data.reels[1]._id === funnyReel.data.reel._id);

    // Pagination: 9 more reels -> 11 total; page size is 8.
    for (let i = 0; i < 9; i += 1) {
      await req('POST', '/api/reels', {
        token: B.token,
        body: { videoUrl: reelUpData.url, caption: `filler ${i}`, interest: 'Sports' },
      });
    }
    const page1 = await req('GET', '/api/reels/feed', { token: C.token });
    const page2 = await req('GET', `/api/reels/feed?cursor=${encodeURIComponent(page1.data.nextCursor || '')}`, {
      token: C.token,
    });
    const ids1 = (page1.data.reels || []).map((r) => r._id);
    const ids2 = (page2.data.reels || []).map((r) => r._id);
    check('reels: feed paginates 8 + rest via cursor, without duplicates',
      page1.status === 200 && ids1.length === 8 && !!page1.data.nextCursor &&
        page2.status === 200 && ids2.length === 3 && !page2.data.nextCursor &&
        new Set([...ids1, ...ids2]).size === 11);

    const like1 = await req('POST', `/api/reels/${techReel.data.reel._id}/like`, { token: A.token });
    check('reels: like toggles on',
      like1.status === 200 && like1.data.liked === true && like1.data.likesCount === 1);
    const like2 = await req('POST', `/api/reels/${techReel.data.reel._id}/like`, { token: A.token });
    check('reels: like toggles back off',
      like2.status === 200 && like2.data.liked === false && like2.data.likesCount === 0);

    const view1 = await req('POST', `/api/reels/${techReel.data.reel._id}/view`, { token: A.token });
    const view2 = await req('POST', `/api/reels/${techReel.data.reel._id}/view`, { token: C.token });
    check('reels: views increment',
      view1.status === 200 && view1.data.views === 1 && view2.status === 200 && view2.data.views === 2);

    const delForbidden = await req('DELETE', `/api/reels/${techReel.data.reel._id}`, { token: A.token });
    check('reels: a non-author cannot delete a reel (403)', delForbidden.status === 403);
    const rlDelOwn = await req('DELETE', `/api/reels/${techReel.data.reel._id}`, { token: B.token });
    check('reels: the author can delete their own reel', rlDelOwn.status === 200);

    // --- Spam rate limits on a dedicated low-limit server -----------------------
    // The main suite needs generous limits, so the spam checks run against a
    // second instance booted with SPAM_* env knobs turned right down.
    const PORT2 = 5056;
    const BASE2 = `http://localhost:${PORT2}`;
    const server2 = spawn('node', ['src/server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(PORT2),
        USE_MEMORY_DB: 'true',
        CLIENT_URL: 'http://localhost:5173',
        PUBLIC_BASE_URL: BASE2,
        JWT_ACCESS_SECRET: 'test-access-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        SPAM_MSG_MAX: '5',
        SPAM_MSG_WINDOW_MS: '3000',
        SPAM_NEW_DISTINCT_MAX: '3',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server2.stderr.on('data', (d) => process.stderr.write(`[server2] ${d}`));
    try {
      for (let i = 0; i < 60; i += 1) {
        try {
          const h = await fetch(`${BASE2}/api/health`);
          if (h.ok) break;
        } catch (err) {
          /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      async function req2(method, url, { token, body } = {}) {
        const res = await fetch(`${BASE2}${url}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, data: await res.json().catch(() => ({})) };
      }
      async function register2(name) {
        const res = await req2('POST', '/api/auth/register', {
          body: { username: name, email: `${name}@spam.test`, password: 'Password1!' },
        });
        return { token: res.data.accessToken, id: res.data.user._id };
      }
      const s1 = await register2('spammer');
      const s2 = await register2('victim2');
      const s3 = await register2('victim3');
      const s4 = await register2('victim4');
      const s5 = await register2('victim5');
      async function spamConv(targetId) {
        const res = await req2('POST', '/api/conversations', {
          token: s1.token,
          body: { type: 'private', participantId: targetId },
        });
        return res.data.conversation._id;
      }
      async function spamSend(conv, n) {
        return req2('POST', '/api/messages', {
          token: s1.token,
          body: { conversationId: conv, content: `spam ${n}`, clientMessageId: `spam-${n}` },
        });
      }
      const sc2 = await spamConv(s2.id);
      const sc3 = await spamConv(s3.id);
      const sc4 = await spamConv(s4.id);
      const sc5 = await spamConv(s5.id);
      const send1 = await spamSend(sc2, 1);
      const send2 = await spamSend(sc3, 2);
      const send3 = await spamSend(sc4, 3);
      check('spam: a new account can message its first few people',
        send1.status === 201 && send2.status === 201 && send3.status === 201);
      const send4 = await spamSend(sc5, 4);
      check('spam: a brand-new account messaging too many distinct people is refused (429)',
        send4.status === 429);
      const send5 = await spamSend(sc2, 5);
      const send6 = await spamSend(sc2, 6);
      check('spam: under the volume cap, sends to an existing contact still work',
        send5.status === 201 && send6.status === 201);
      const send7 = await spamSend(sc2, 7);
      check('spam: exceeding the per-user volume limit trips 429', send7.status === 429);
      let resetSend = null;
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        resetSend = await spamSend(sc2, 100 + i);
        if (resetSend.status === 201) break;
      }
      check('spam: the volume limit resets after the window passes',
        !!resetSend && resetSend.status === 201);

      // --- Full password-reset flow on this isolated instance ----------------
      // (Kept off the main server: its shared auth rate limiter is already
      // busy from the rest of the suite, and the dev-mode reset link is
      // printed to this process's stdout, captured here.)
      let server2Out = '';
      server2.stdout.on('data', (d) => {
        server2Out += d.toString();
      });
      const rsReg = await req2('POST', '/api/auth/register', {
        body: { username: 'resetu', email: 'resetu@spam.test', password: 'Password1!' },
      });
      check('account: reset-test user registers on the isolated server', rsReg.status === 201);
      await req2('POST', '/api/auth/forgot-password', { body: { email: 'resetu@spam.test' } });
      await new Promise((r) => setTimeout(r, 400));
      const tokenMarker = 'reset-password?token=';
      const tokenAt = server2Out.indexOf(tokenMarker);
      let capturedToken = null;
      if (tokenAt >= 0) {
        const candidate = server2Out.slice(tokenAt + tokenMarker.length, tokenAt + tokenMarker.length + 64);
        const isHex = [...candidate].every((c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));
        if (candidate.length === 64 && isHex) capturedToken = candidate;
      }
      const tokenMatch = capturedToken ? [null, capturedToken] : null;
      check('account: forgot-password issued a reset token (dev console link)', !!tokenMatch);
      const resetOk = await req2('POST', '/api/auth/reset-password', {
        body: { token: tokenMatch ? tokenMatch[1] : 'x'.repeat(64), newPassword: 'BrandNew1!' },
      });
      check('account: reset with the real token succeeds', resetOk.status === 200);
      const oldPwLogin = await req2('POST', '/api/auth/login', {
        body: { email: 'resetu@spam.test', password: 'Password1!' },
      });
      check('account: the old password stops working after a reset', oldPwLogin.status === 401);
      const newPwLogin = await req2('POST', '/api/auth/login', {
        body: { email: 'resetu@spam.test', password: 'BrandNew1!' },
      });
      check('account: the new password works after a reset', newPwLogin.status === 200);
      const resetReuse = await req2('POST', '/api/auth/reset-password', {
        body: { token: tokenMatch ? tokenMatch[1] : 'y'.repeat(64), newPassword: 'Another1!' },
      });
      check('account: a reset token cannot be reused (400)', resetReuse.status === 400);
    } finally {
      server2.kill('SIGTERM');
    }


    sockC.close();
    sockD.close();
    sockA.close();
    sockB.close();
  } finally {
    server.kill('SIGTERM');
    weatherStub.close();
  }

  console.log(`\n[test] Done: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('[test] Failures:');
    failures.forEach((f) => console.log('  -', f));
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('[test] Fatal:', err);
  process.exit(1);
});
