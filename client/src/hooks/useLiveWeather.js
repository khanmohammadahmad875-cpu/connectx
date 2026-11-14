import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { usePrefs } from '../context/PreferencesContext';
import { weatherSceneForCode } from '../utils/weather';

// Live weather for the animated backgrounds (polish item 6): fetches the
// current conditions for the user's primary saved city, cached module-wide
// and refreshed at most every 30 minutes. Returns null when there is no
// saved city or the fetch fails — callers fall back silently.
const CACHE_TTL = 30 * 60 * 1000;
let cache = { key: '', at: 0, data: null };
let inflight = null;

async function fetchScene(city) {
  const params = new URLSearchParams({
    lat: String(city.lat),
    lon: String(city.lon),
    name: city.name || '',
    country: city.country || '',
  });
  const data = await api(`/api/weather/current?${params.toString()}`);
  const code = data?.current?.weatherCode;
  const hour = data?.current?.time ? Number(String(data.current.time).slice(11, 13)) : 12;
  const isDay = Number.isFinite(hour) ? hour >= 6 && hour < 19 : true;
  return { scene: weatherSceneForCode(code, isDay), code, isDay, condition: data?.current?.condition || '' };
}

export function useLiveWeather() {
  const { prefs } = usePrefs();
  const city = prefs?.weatherCities?.[0] || null;
  const key = city ? `${city.lat},${city.lon}` : '';
  const [state, setState] = useState(() => (cache.key === key && cache.data ? cache.data : null));

  useEffect(() => {
    if (!city) {
      setState(null);
      return undefined;
    }
    if (cache.key === key && cache.data && Date.now() - cache.at < CACHE_TTL) {
      setState(cache.data);
      return undefined;
    }
    let cancelled = false;
    if (!inflight || inflight.key !== key) {
      inflight = { key, promise: fetchScene(city).catch(() => null) };
    }
    inflight.promise.then((data) => {
      if (data) cache = { key, at: Date.now(), data };
      if (!cancelled) setState(data);
    });
    const timer = setInterval(() => {
      cache = { key: '', at: 0, data: null };
      fetchScene(city)
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
