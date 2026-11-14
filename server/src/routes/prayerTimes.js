const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Prayer / Namaz times — Aladhan API (free, no key). Calculation method
// 1 = University of Islamic Sciences, Karachi: the standard method used
// for azan times across Pakistan (Hanafi Asr). Base URL can be
// overridden by env (used by the e2e suite to stub the provider):
//   ALADHAN_URL (default https://api.aladhan.com/v1)
const BASE_URL = () => process.env.ALADHAN_URL || 'https://api.aladhan.com/v1';
// Defaults follow the Azan apps used in Pakistan: Karachi calculation,
// Hanafi juristic method (Asr). Both are client-adjustable in Settings.
const DEFAULT_METHOD = 1;
const DEFAULT_SCHOOL = 1;

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map(); // key -> { at, data }

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) {
    const err = new Error(`Prayer-times provider answered ${res.status}`);
    err.status = 502;
    throw err;
  }
  return res.json();
}

const PRAYERS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const cleanTime = (v) => String(v || '').split(' ')[0]; // strip " (PKT)" suffixes

router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ message: 'lat and lon query parameters are required' });
  }
  const methodRaw = parseInt(req.query.method, 10);
  const method =
    Number.isInteger(methodRaw) && methodRaw >= 0 && methodRaw <= 12 ? methodRaw : DEFAULT_METHOD;
  const school = req.query.school === '0' ? 0 : DEFAULT_SCHOOL;
  const day = new Date().toISOString().slice(0, 10);
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${day},${method},${school}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return res.json(cached.data);
  try {
    const ts = Math.floor(Date.now() / 1000);
    const url = `${BASE_URL()}/timings/${ts}?latitude=${lat}&longitude=${lon}&method=${method}&school=${school}`;
    const raw = await fetchJson(url);
    const data = raw && raw.data;
    if (!data || !data.timings) {
      const err = new Error('Prayer-times provider returned an unexpected response');
      err.status = 502;
      throw err;
    }
    const timings = {};
    for (const name of PRAYERS) timings[name] = cleanTime(data.timings[name]);
    const hijri = data.date && data.date.hijri;
    const out = {
      timings,
      timezone: (data.meta && data.meta.timezone) || '',
      method: (data.meta && data.meta.method && data.meta.method.name) || 'University of Islamic Sciences, Karachi',
      gregorian: (data.date && data.date.readable) || '',
      hijri: hijri
        ? {
            day: hijri.day,
            month: hijri.month && hijri.month.en,
            year: hijri.year,
            weekday: hijri.weekday && hijri.weekday.en,
          }
        : null,
    };
    cache.set(key, { at: Date.now(), data: out });
    return res.json(out);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({
      message:
        status === 502
          ? 'Prayer-times service is unavailable right now. Please try again shortly.'
          : err.message,
    });
  }
});

module.exports = router;
