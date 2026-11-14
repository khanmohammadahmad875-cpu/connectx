// WebRTC configuration (module 8) — the single place call media settings
// live. Peers use public STUN servers to discover their public addresses,
// plus free TURN relays (the Open Relay Project's public endpoints) for
// networks where direct peer-to-peer media cannot pass. Most mobile-data
// carriers sit behind strict NAT/CGNAT, where STUN alone can ring a call
// but never connect its audio/video — the TURN relay fixes that case.
// Override with VITE_ICE_SERVERS (JSON array) at build time.
const TURN_SERVERS = [
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

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
  const stunUrls = (
    import.meta.env.VITE_STUN_URLS ||
    'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun2.l.google.com:19302,stun:stun.cloudflare.com:3478,stun:global.stun.twilio.com:3478'
  )
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  return [...stunUrls.map((u) => ({ urls: u })), ...TURN_SERVERS];
}

export const ICE_SERVERS = loadIceServers();
export const RTC_CONFIG = { iceServers: ICE_SERVERS };
