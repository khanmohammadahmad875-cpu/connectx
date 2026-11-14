import { api } from '../services/api';

// City-name resolution for GPS positions (the user's request: wherever
// the app uses the current location, SHOW the city's name — Maneri,
// Swabi, Peshawar — so it is always clear whose weather, Namaz times
// and clock are on screen). The server resolves coordinates via
// /api/weather/reverse; results are cached here and in the shared
// connectx_geo storage so every widget reads the same name.
const NAME_TTL = 30 * 60 * 1000;
let mem = null; // { key, at, name }

function near(a, b) {
  return Math.abs(a - b) < 0.05;
}

export function storedCityName(lat, lon) {
  try {
    const g = JSON.parse(localStorage.getItem('connectx_geo') || 'null');
    if (g && g.name && near(g.lat, lat) && near(g.lon, lon)) return g.name;
  } catch {
    /* storage unavailable */
  }
  return '';
}

export function storedGeoName() {
  try {
    const g = JSON.parse(localStorage.getItem('connectx_geo') || 'null');
    return (g && g.name) || '';
  } catch {
    return '';
  }
}

export async function resolveCityName(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (mem && mem.key === key && Date.now() - mem.at < NAME_TTL) return mem.name;
  const stored = storedCityName(lat, lon);
  if (stored) {
    mem = { key, at: Date.now(), name: stored };
    return stored;
  }
  try {
    const data = await api(`/api/weather/reverse?lat=${lat}&lon=${lon}`);
    const name = data?.name || '';
    mem = { key, at: Date.now(), name };
    if (name) {
      try {
        const g = JSON.parse(localStorage.getItem('connectx_geo') || 'null');
        if (g && near(g.lat, lat) && near(g.lon, lon)) {
          localStorage.setItem('connectx_geo', JSON.stringify({ ...g, name }));
        }
      } catch {
        /* best-effort */
      }
    }
    return name;
  } catch {
    return '';
  }
}
