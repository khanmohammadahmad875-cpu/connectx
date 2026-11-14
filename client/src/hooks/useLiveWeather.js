import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { usePrefs } from '../context/PreferencesContext';
import { weatherSceneForCode } from '../utils/weather';

// Live weather for the animated backgrounds (polish item 6; location logic
// added at the user's request): the scene follows the user's CURRENT
// location whenever the device location is available (browser geolocation,
// or the Android app's location permission). When location is off, denied
// or unavailable, it falls back to the last city the user set (their first
// saved weather city). Results are cached module-wide and refreshed at most
// every 30 minutes. Returns null when neither source exists or the fetch
// fails — callers fall back silently.
const CACHE_TTL = 30 * 60 * 1000;
const GEO_KEY = 'connectx_geo';
let cache = { key: '', at: 0, data: null };
let inflight = null;

async function fetchScene(loc) {
  const params = new URLSearchParams({
    lat: String(loc.lat),
    lon: String(loc.lon),
    name: loc.name || '',
    country: loc.country || '',
  });
  const data = await api(`/api/weather/current?${params.toString()}`);
  const code = data?.current?.weatherCode;
  const hour = data?.current?.time ? Number(String(data.current.time).slice(11, 13)) : 12;
  const isDay = Number.isFinite(hour) ? hour >= 6 && hour < 19 : true;
  return { scene: weatherSceneForCode(code, isDay), code, isDay, condition: data?.current?.condition || '' };
}

function readGeoCache() {
  try {
    const g = JSON.parse(localStorage.getItem(GEO_KEY) || 'null');
    if (g && Number.isFinite(g.lat) && Number.isFinite(g.lon)) return g;
  } catch {
    /* storage unavailable */
  }
  return null;
}

function samePlace(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.05;
}

// Ask the device for its current position once; resolves to {lat, lon} or
// null (denied, timed out, unsupported). Never rejects.
function requestPosition() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => finish({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => finish(null),
        { timeout: 8000, maximumAge: 10 * 60 * 1000 }
      );
    } catch {
      finish(null);
    }
    setTimeout(() => finish(null), 9000);
  });
}

export function useLiveWeather() {
  const { prefs } = usePrefs();
  const savedCity = prefs?.weatherCities?.[0] || null;
  const savedLoc = savedCity
    ? { lat: savedCity.lat, lon: savedCity.lon, name: savedCity.name || '', country: savedCity.country || '' }
    : null;

  const [geoLoc, setGeoLoc] = useState(() => {
    const g = readGeoCache();
    return g ? { lat: g.lat, lon: g.lon, name: 'Current location', country: '' } : null;
  });
  const geoAsked = useRef(false);

  // Location first: ask the device once per mount (and rely on the cached
  // position between mounts). A denial simply keeps the saved-city scene.
  useEffect(() => {
    if (geoAsked.current) return undefined;
    geoAsked.current = true;
    let cancelled = false;
    const cached = readGeoCache();
    if (cached && Date.now() - cached.at < CACHE_TTL) return undefined;
    requestPosition().then((pos) => {
      if (cancelled || !pos) return;
      try {
        localStorage.setItem(GEO_KEY, JSON.stringify({ ...pos, at: Date.now() }));
      } catch {
        /* storage unavailable */
      }
      setGeoLoc((prev) =>
        samePlace(prev, pos) ? prev : { lat: pos.lat, lon: pos.lon, name: 'Current location', country: '' }
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Current location wins when we have it; otherwise the last city set.
  const loc = geoLoc || savedLoc;
  const key = loc ? `${loc.lat},${loc.lon}` : '';
  const [state, setState] = useState(() => (cache.key === key && cache.data ? cache.data : null));

  useEffect(() => {
    if (!loc) {
      setState(null);
      return undefined;
    }
    if (cache.key === key && cache.data && Date.now() - cache.at < CACHE_TTL) {
      setState(cache.data);
      return undefined;
    }
    let cancelled = false;
    if (!inflight || inflight.key !== key) {
      inflight = { key, promise: fetchScene(loc).catch(() => null) };
    }
    inflight.promise.then((data) => {
      if (data) cache = { key, at: Date.now(), data };
      if (!cancelled) setState(data);
    });
    const timer = setInterval(() => {
      cache = { key: '', at: 0, data: null };
      fetchScene(loc)
        .then((data) => {
          if (data) cache = { key, at: Date.now(), data };
          if (!cancelled && data) setState(data);
        })
        .catch(() => {});
    }, CACHE_TTL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
