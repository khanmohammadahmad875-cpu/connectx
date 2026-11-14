// Chat-lock unlock grant storage (Module 19). The grant is a short-lived
// token issued by the server after PIN verification; it lives in
// sessionStorage so it disappears when the tab closes.
const KEY = 'connectx_unlock';

export function getUnlockToken() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw);
    if (!token || !expiresAt || Date.now() > expiresAt) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return token;
  } catch (err) {
    return null;
  }
}

export function setUnlockToken(token, expiresAt) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ token, expiresAt }));
  } catch (err) {
    /* storage unavailable */
  }
}

export function clearUnlockToken() {
  try {
    sessionStorage.removeItem(KEY);
  } catch (err) {
    /* ignore */
  }
}

export function hasUnlockGrant() {
  return !!getUnlockToken();
}
