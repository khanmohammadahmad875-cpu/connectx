import { io } from 'socket.io-client';
import { API_URL, getToken } from '../services/api';

let socket = null;

export function connectSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();
  // Empty API_URL means same-origin (production single deploy / dev proxy).
  socket = io(API_URL || window.location.origin, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
