import { io } from 'socket.io-client';
import { API_URL, getToken } from '../services/api';

let socket = null;

export function connectSocket() {
  const token = getToken();
  if (!token) return null;
  // One socket for the whole session. Earlier this recreated the socket on
  // every call while it was disconnected, which churned the connection and
  // could leave call signalling attached to a dead instance. The auth is a
  // function, so every (re)connect attempt sends the CURRENT access token —
  // a silent token refresh no longer strands the socket with a stale one.
  if (socket) return socket;
  // Empty API_URL means same-origin (production single deploy / dev proxy).
  socket = io(API_URL || window.location.origin, {
    auth: (cb) => cb({ token: getToken() }),
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

// Resolves with a CONNECTED socket, waiting for an in-flight reconnect for
// up to `timeoutMs`. Resolves null when there is no token or the wait times
// out. Call signalling uses this so a tap on the call button right after
// the app wakes up no longer fails instantly with "Not connected".
export function waitForSocket(timeoutMs = 8000) {
  const s = connectSocket();
  if (!s) return Promise.resolve(null);
  if (s.connected) return Promise.resolve(s);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.off('connect', onConnect);
      resolve(s.connected ? s : null);
    }, timeoutMs);
    const onConnect = () => {
      clearTimeout(timer);
      resolve(s);
    };
    s.once('connect', onConnect);
  });
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
