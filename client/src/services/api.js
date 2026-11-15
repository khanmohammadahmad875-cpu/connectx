// REST client for the ConnectX API.
// Access token lives in localStorage; when it expires (401) we silently use
// the HttpOnly refresh cookie once and retry the request.
//
// API base: VITE_API_URL when set (split client/server deploys); otherwise
// SAME-ORIGIN relative URLs — the production server serves this client
// itself (SERVE_CLIENT), and the Vite dev server proxies /api in local dev.
const API_URL = import.meta.env.VITE_API_URL || '';
import { getUnlockToken } from '../utils/lock';

const TOKEN_KEY = 'connectx_access_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Every request gets a hard timeout. A bare fetch can hang forever when
// the server is mid-restart (a deploy swaps containers) or the network
// stalls — the UI then sits on a spinner ("Sharing…") until Android kills
// the page with an "Application failed to respond" dialog.
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Server se jawab nahi aaya — internet check karke dobara try karo.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAccessToken() {
  const res = await fetchWithTimeout(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  }, 10000);
  if (!res.ok) return null;
  const data = await res.json();
  setToken(data.accessToken);
  return data.accessToken;
}

export async function api(path, { method = 'GET', body, headers: extraHeaders, unlock = false, _retried = false } = {}) {
  const headers = { ...(extraHeaders || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Chat lock (Module 19): locked-conversation requests carry the unlock
  // grant; the server refuses them with 423 without it.
  if (unlock) {
    const grant = getUnlockToken();
    if (grant) headers['X-Unlock-Token'] = grant;
  }

  const res = await fetchWithTimeout(`${API_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !_retried && !path.startsWith('/api/auth/')) {
    const fresh = await refreshAccessToken();
    if (fresh) return api(path, { method, body, headers: extraHeaders, unlock, _retried: true });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const token = getToken();
  const res = await fetchWithTimeout(`${API_URL}/api/uploads`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: form,
  }, 120000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Upload failed');
  return data; // { url, messageType, originalName }
}

export { API_URL };
