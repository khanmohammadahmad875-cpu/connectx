/**
 * ConnectX end-to-end test suite.
 * Boots the real server (in-memory MongoDB) on a test port and runs the
 * acceptance scenarios from the project spec (SRS section 8) plus extras.
 *
 * Run:  node tests/e2e.cjs
 */
const { spawn } = require('child_process');
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

async function main() {
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

    sockA.close();
    sockB.close();
  } finally {
    server.kill('SIGTERM');
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
