// WebRTC configuration (module 8) — the single place call media settings
// live. STUN only: public STUN servers help peers behind most home/mobile
// NATs find each other. There is no TURN relay, so calls on very strict
// NATs may fail to connect (documented in docs/EXPANSION-V3.md).
// Override with VITE_ICE_SERVERS (JSON array) or VITE_STUN_URLS
// (comma-separated stun: URLs) at build time.
function loadIceServers() {
  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (err) {
      /* fall through to the defaults */
    }
  }
  const urls = (import.meta.env.VITE_STUN_URLS ||
    'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  return urls.map((u) => ({ urls: u }));
}

export const ICE_SERVERS = loadIceServers();
export const RTC_CONFIG = { iceServers: ICE_SERVERS };
