const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Weather (v3.0 module 26) — Open-Meteo only: free, no API key.
// Base URLs can be overridden by env (used by the e2e suite to stub the
// provider so tests never depend on the network):
//   OPEN_METEO_GEO_URL   (default https://geocoding-api.open-meteo.com/v1/search)
//   OPEN_METEO_API_URL   (default https://api.open-meteo.com/v1/forecast)
const GEO_URL = () => process.env.OPEN_METEO_GEO_URL || 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = () => process.env.OPEN_METEO_API_URL || 'https://api.open-meteo.com/v1/forecast';

// WMO weather codes → human-readable condition (Open-Meteo uses WMO 4677).
const WMO_CONDITIONS = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Slight rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Freezing rain',
  71: 'Slight snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
};
const conditionText = (code) => WMO_CONDITIONS[code] || 'Unknown';

// Short in-memory cache: identical coordinates are re-fetched at most once
// per ~10 minutes, no matter how many users/widgets ask.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // key -> { at, data }

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) {
    const err = new Error(`Weather provider answered ${res.status}`);
    err.status = 502;
    throw err;
  }
  return res.json();
}

async function resolveLocation(req) {
  const lat = Number.parseFloat(req.query.lat);
  const lon = Number.parseFloat(req.query.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return {
      name: (req.query.name || '').toString().slice(0, 80),
      country: (req.query.country || '').toString().slice(0, 80),
      latitude: lat,
      longitude: lon,
      timezone: '',
    };
  }
  const city = (req.query.city || '').toString().trim();
  if (!city) {
    const err = new Error('Provide a city name (?city=) or coordinates (?lat=&lon=)');
    err.status = 400;
    throw err;
  }
  const url = `${GEO_URL()}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const data = await fetchJson(url);
  const hit = (data.results || [])[0];
  if (!hit) {
    const err = new Error(`City not found: ${city}`);
    err.status = 404;
    throw err;
  }
  return {
    name: hit.name || city,
    country: hit.country || '',
    latitude: hit.latitude,
    longitude: hit.longitude,
    timezone: hit.timezone || '',
  };
}

async function getForecast(location) {
  const key = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;

  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '7',
  });
  const data = await fetchJson(`${FORECAST_URL()}?${params.toString()}`);
  if (!data.current || !data.hourly || !data.daily) {
    const err = new Error('Weather provider returned an unexpected response');
    err.status = 502;
    throw err;
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

function currentShape(raw, location) {
  const c = raw.current;
  return {
    location: { ...location, timezone: raw.timezone || location.timezone || '' },
    current: {
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      weatherCode: c.weather_code,
      condition: conditionText(c.weather_code),
      time: c.time,
    },
  };
}

function forecastShape(raw, location) {
  const times = raw.hourly.time || [];
  const nowIso = raw.current?.time || '';
  let start = times.findIndex((t) => t >= nowIso);
  if (start < 0) start = 0;
  const hourly = [];
  for (let i = start; i < Math.min(start + 24, times.length); i += 1) {
    const code = raw.hourly.weather_code[i];
    hourly.push({
      time: times[i],
      temperature: raw.hourly.temperature_2m[i],
      weatherCode: code,
      condition: conditionText(code),
    });
  }
  const daily = (raw.daily.time || []).map((date, i) => {
    const code = raw.daily.weather_code[i];
    return {
      date,
      min: raw.daily.temperature_2m_min[i],
      max: raw.daily.temperature_2m_max[i],
      weatherCode: code,
      condition: conditionText(code),
    };
  });
  return {
    location: { ...location, timezone: raw.timezone || location.timezone || '' },
    hourly,
    daily,
  };
}

function handle(shapeFn) {
  return async (req, res) => {
    try {
      const location = await resolveLocation(req);
      const raw = await getForecast(location);
      return res.json(shapeFn(raw, location));
    } catch (err) {
      const status = err.status || 502;
      return res.status(status).json({
        message:
          status === 502
            ? 'Weather service is unavailable right now. Please try again shortly.'
            : err.message,
      });
    }
  };
}

router.get('/current', handle(currentShape));
router.get('/forecast', handle(forecastShape));

// Reverse geocoding: coordinates → the place name to SHOW the user, so
// "current location" always reads as the real city (Maneri, Swabi,
// Peshawar...) on the weather, Namaz and clock widgets. Provider:
// BigDataCloud's free client API (no key needed). Base overridable by
// env for the e2e suite: REVERSE_GEO_URL.
const REVERSE_URL = () =>
  process.env.REVERSE_GEO_URL || 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const reverseCache = new Map(); // "lat,lon" (2dp) -> { at, data }

async function fetchReverseJson(url, headers) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers });
  if (!res.ok) {
    const err = new Error(`Reverse geocoding provider answered ${res.status}`);
    err.status = 502;
    throw err;
  }
  return res.json();
}

// Both providers' shapes → one answer. BigDataCloud: city/locality at
// the top level. Nominatim: everything under .address (city/town/
// village/hamlet/county, state, country).
function mapReverse(data, lat, lon) {
  if (!data) return null;
  const a = data.address || {};
  return {
    name:
      data.city ||
      data.locality ||
      a.city ||
      a.town ||
      a.village ||
      a.hamlet ||
      a.county ||
      data.principalSubdivision ||
      a.state ||
      '',
    admin: data.principalSubdivision || a.state || '',
    country: data.countryName || a.country || '',
    latitude: lat,
    longitude: lon,
  };
}

router.get('/reverse', async (req, res) => {
  try {
    const lat = Number.parseFloat(req.query.lat);
    const lon = Number.parseFloat(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ message: 'Provide valid ?lat= and ?lon= coordinates' });
    }
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hitCache = reverseCache.get(key);
    if (hitCache && Date.now() - hitCache.at < 30 * 60 * 1000) return res.json(hitCache.data);
    let out = null;
    if (process.env.REVERSE_GEO_URL) {
      // Test/stub path: exactly one provider, BigDataCloud-shaped reply.
      const data = await fetchJson(
        `${REVERSE_URL()}?latitude=${lat}&longitude=${lon}&localityLanguage=en`
      );
      out = mapReverse(data, lat, lon);
    } else {
      // Production: BigDataCloud direct host first (their main host
      // 307-redirects here anyway, and the redirect hop failed from the
      // production network), OpenStreetMap Nominatim as the fallback —
      // different networks, so one of them answers from anywhere.
      try {
        const data = await fetchReverseJson(
          `https://api-bdc.io/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
        );
        out = mapReverse(data, lat, lon);
      } catch {
        out = null;
      }
      if (!out || !out.name) {
        const data = await fetchReverseJson(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
          { 'User-Agent': 'ConnectX/1.0 (personal project weather widget)' }
        );
        out = mapReverse(data, lat, lon);
      }
    }
    if (!out) throw new Error('Reverse geocoding returned an unexpected response');
    reverseCache.set(key, { at: Date.now(), data: out });
    return res.json(out);
  } catch (err) {
    return res
      .status(502)
      .json({ message: 'Location name service is unavailable right now. Please try again shortly.' });
  }
});

module.exports = router;
