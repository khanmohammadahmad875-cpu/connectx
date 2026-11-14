import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { resolveCityName, storedCityName } from '../utils/geo';

// Namaz (prayer) times in the classic Azan-app style: mint cards, the
// next prayer lit up solid green, a settings block underneath — Change
// Location, Auto Update Location, Juristic Method (Hanafi/Shafi),
// Calculation Method (Karachi + others), Hijri Adjustment — and a
// per-prayer reminder behind every row's gear. Times come from the
// server (Aladhan); defaults are Karachi + Hanafi, the Pakistan azan
// standard. Works for any searched city or the current location.
const PRAYERS = [
  ['Fajr', '🌅'],
  ['Sunrise', '🌄'],
  ['Dhuhr', '☀️'],
  ['Asr', '🌤️'],
  ['Maghrib', '🌇'],
  ['Isha', '🌙'],
];
const METHODS = [
  { v: 1, l: 'Karachi' },
  { v: 3, l: 'Muslim World League' },
  { v: 2, l: 'ISNA (North America)' },
  { v: 5, l: 'Egypt' },
  { v: 4, l: 'Makkah' },
  { v: 8, l: 'Gulf' },
];
const FALLBACK_PLACE = { name: 'Peshawar', lat: 34.0151, lon: 71.5249 };
const SETTINGS_KEY = 'connectx_prayer_settings_v2';
const PLACE_KEY = 'connectx_prayer_place';

const DEFAULT_SETTINGS = {
  method: 1,
  school: 1, // 1 = Hanafi, 0 = Shafi
  hijriAdj: 0,
  autoLoc: true,
  alertsOn: true,
  reminders: {}, // name -> { on: bool, lead: minutes }
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}) };
  } catch (err) {
    return { ...DEFAULT_SETTINGS };
  }
}

function fmt12(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

function nowSecondsIn(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || undefined,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    return get('hour') * 3600 + get('minute') * 60 + get('second');
  } catch (err) {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }
}

function prayerSeconds(timings, name) {
  const [h, m] = String(timings[name]).split(':').map(Number);
  return h * 3600 + m * 60;
}

function nextPrayer(timings, tz) {
  if (!timings) return null;
  const now = nowSecondsIn(tz);
  for (const [name] of PRAYERS) {
    const at = prayerSeconds(timings, name);
    if (at > now) return { name, at, inSec: at - now };
  }
  const at = prayerSeconds(timings, 'Fajr');
  return { name: 'Fajr', at, inSec: at + 86400 - now };
}

function fmtCountdown(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Hijri label: the API's own date when there is no adjustment; with an
// adjustment (moon-sighting offset) the Islamic calendar built into the
// browser converts the shifted Gregorian date.
function hijriLabel(data, adj) {
  if (adj === 0 && data?.hijri) {
    return `${data.hijri.day} ${data.hijri.month} ${data.hijri.year} AH`;
  }
  try {
    const shifted = new Date(Date.now() + (adj || 0) * 86400000);
    return new Intl.DateTimeFormat('en-SA-u-ca-islamic', {
      timeZone: data?.timezone || undefined,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(shifted);
  } catch (err) {
    return data?.hijri ? `${data.hijri.day} ${data.hijri.month} ${data.hijri.year} AH` : '';
  }
}

export default function PrayerTimesCard() {
  const [settings, setSettings] = useState(loadSettings);
  const [place, setPlace] = useState(() => {
    // A place the user chose (search or Current) wins and survives reloads;
    // then the cached device location; then the Peshawar fallback.
    try {
      const saved = JSON.parse(localStorage.getItem(PLACE_KEY) || 'null');
      if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon) && saved.name) {
        return saved;
      }
      const geo = JSON.parse(localStorage.getItem('connectx_geo') || 'null');
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
        return { name: storedCityName(geo.lat, geo.lon) || 'Current location', lat: geo.lat, lon: geo.lon };
      }
    } catch (err) {
      /* fall through */
    }
    return FALLBACK_PLACE;
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [openGear, setOpenGear] = useState('');
  const [, setTick] = useState(0);
  const searchRef = useRef(null);
  const firedRef = useRef(new Set());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const dataRef = useRef(null);
  dataRef.current = data;
  const placeRef = useRef(place);
  placeRef.current = place;

  // Choosing a place is sticky: it is saved and restored on the next open.
  const choosePlace = useCallback((p) => {
    setPlace(p);
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify(p));
    } catch (err) {
      /* storage is best-effort */
    }
  }, []);

  const saveSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch (err) {
        /* storage is best-effort */
      }
      return next;
    });
  }, []);

  const load = useCallback(async (p, s) => {
    setBusy(true);
    setError('');
    try {
      const res = await api(
        `/api/prayer-times?lat=${p.lat}&lon=${p.lon}&method=${s.method}&school=${s.school}`
      );
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load(place, settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.lat, place.lon, settings.method, settings.school]);

  // A GPS place starts life labelled "Current location"; replace that
  // generic label with the real city name as soon as it resolves, so the
  // card always says whose Namaz times these are.
  useEffect(() => {
    if (place.name !== 'Current location') return undefined;
    let cancelled = false;
    resolveCityName(place.lat, place.lon).then((name) => {
      if (!cancelled && name) choosePlace({ name, lat: place.lat, lon: place.lon });
    });
    return () => {
      cancelled = true;
    };
  }, [place.name, place.lat, place.lon, choosePlace]);

  // Tick every second for the countdown; check reminders every tick too
  // (cheap, and the fired-set keeps each alert one-shot per day).
  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1);
      const d = dataRef.current;
      const s = settingsRef.current;
      if (!d || !s.alertsOn || typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;
      const now = nowSecondsIn(d.timezone);
      const dayKey = new Date().toDateString();
      for (const [name] of PRAYERS) {
        const r = s.reminders[name];
        if (!r || !r.on) continue;
        const target = prayerSeconds(d.timings, name) - (r.lead || 0) * 60;
        const key = `${dayKey}-${name}`;
        if (now >= target && now - target < 30 && !firedRef.current.has(key)) {
          firedRef.current.add(key);
          try {
            new Notification(`🕌 ${name} — ${placeRef.current.name}`, {
              body:
                (r.lead || 0) > 0
                  ? `${name} is in ${r.lead} minutes (${fmt12(d.timings[name])}).`
                  : `It is time for ${name} (${fmt12(d.timings[name])}).`,
              icon: '/icon-192.png',
            });
          } catch (err) {
            /* notifications are best-effort */
          }
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const useMyLocation = useCallback((quiet) => {
    if (!navigator.geolocation) {
      if (!quiet) setNote('Is browser mein location ki sahulat nahi hai — city search kar lo, wohi chalegi.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          localStorage.setItem('connectx_geo', JSON.stringify({ lat, lon, at: Date.now() }));
        } catch (err) {
          /* cache is best-effort */
        }
        setNote('');
        choosePlace({ name: storedCityName(lat, lon) || 'Current location', lat, lon });
        resolveCityName(lat, lon).then((name) => {
          if (name) choosePlace({ name, lat, lon });
        });
      },
      () => {
        // NOT an app error: the phone's Location is off or the permission
        // was not given. Keep the saved city running and say so softly —
        // never a red error the user can do nothing about.
        if (!quiet) {
          setNote('Location nahi mili — phone ki Location ON karke dobara try karo, ya city search kar lo. Saved city chalti rahegi.');
        }
      },
      { timeout: 10000, maximumAge: 300000, enableHighAccuracy: false }
    );
  }, [choosePlace]);

  // Auto Update Location: refresh from the device each time the card opens.
  useEffect(() => {
    if (settingsRef.current.autoLoc) useMyLocation(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(e) {
    e.preventDefault();
    const city = query.trim();
    if (!city) return;
    setBusy(true);
    setError('');
    try {
      const w = await api(`/api/weather/current?city=${encodeURIComponent(city)}`);
      const loc = w.location || {};
      const lat = loc.latitude ?? loc.lat;
      const lon = loc.longitude ?? loc.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('City not found');
      choosePlace({ name: [loc.name, loc.country].filter(Boolean).join(', ') || city, lat, lon });
      // A hand-picked city stays fixed until the user changes it again.
      if (settingsRef.current.autoLoc) saveSettings({ autoLoc: false });
    } catch (err) {
      setError(err.message || 'City not found');
      setBusy(false);
    }
  }

  function enableAlerts(patch) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    saveSettings(patch);
  }

  const next = data ? nextPrayer(data.timings, data.timezone) : null;
  const methodName =
    METHODS.find((m) => m.v === settings.method)?.l || 'Karachi';

  return (
    <div className="azan">
      <form className="azan-search" onSubmit={search}>
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search city — e.g. Lahore, Karachi…"
          aria-label="Search city for prayer times"
        />
        <button type="submit" className="mini-btn" disabled={busy}>
          Search
        </button>
        <button type="button" className="mini-btn" onClick={() => useMyLocation(false)} disabled={busy}>
          📍 Current
        </button>
      </form>

      <div className="azan-place">
        <span>🕌 {place.name}</span>
        {data && <span className="info-sub">{hijriLabel(data, settings.hijriAdj)}</span>}
      </div>
      {next && data && (
        <div className="azan-next">
          ⏳ {next.name} · {fmt12(data.timings[next.name])} · in <b>{fmtCountdown(next.inSec)}</b>
        </div>
      )}
      {error && <p className="prayer-error">{error}</p>}
      {note && <p className="empty-note">{note}</p>}
      {busy && !data && <p className="info-sub">Loading prayer times…</p>}

      {data && (
        <ul className="azan-list">
          {PRAYERS.map(([name, icon]) => {
            const isNext = next && next.name === name;
            const reminder = settings.reminders[name] || { on: false, lead: 0 };
            return (
              <li key={name} className={isNext ? 'active' : ''}>
                <div className="azan-row">
                  <span className="azan-ic">{icon}</span>
                  <span className="azan-name">{name}</span>
                  <span className="azan-time">{fmt12(data.timings[name])}</span>
                  <button
                    type="button"
                    className="azan-gear"
                    title={`${name} reminder settings`}
                    onClick={() => setOpenGear((g) => (g === name ? '' : name))}
                  >
                    ⚙️
                  </button>
                </div>
                {openGear === name && (
                  <div className="azan-gearpanel">
                    <label className="switch-row">
                      <span>🔔 Remind me</span>
                      <input
                        type="checkbox"
                        checked={!!reminder.on}
                        onChange={(e) =>
                          enableAlerts({
                            reminders: {
                              ...settings.reminders,
                              [name]: { ...reminder, on: e.target.checked },
                            },
                          })
                        }
                      />
                    </label>
                    <label className="azan-lead">
                      <span>Alert</span>
                      <select
                        value={reminder.lead || 0}
                        onChange={(e) =>
                          saveSettings({
                            reminders: {
                              ...settings.reminders,
                              [name]: { ...reminder, lead: Number(e.target.value) },
                            },
                          })
                        }
                      >
                        <option value={0}>at prayer time</option>
                        <option value={5}>5 min before</option>
                        <option value={10}>10 min before</option>
                        <option value={15}>15 min before</option>
                      </select>
                    </label>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h4 className="azan-sec">Location Settings</h4>
      <div className="azan-cards">
        <button
          type="button"
          className="azan-setrow"
          onClick={() => {
            searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            searchRef.current?.focus();
          }}
        >
          <span className="azan-set-ic">📍</span>
          <span className="azan-set-main">
            Change Location
            <small>{place.name}</small>
          </span>
          <span className="azan-chev">›</span>
        </button>
        <label className="azan-setrow switch-row">
          <span className="azan-set-ic">🎯</span>
          <span className="azan-set-main">Auto Update Location</span>
          <input
            type="checkbox"
            checked={settings.autoLoc}
            onChange={(e) => {
              saveSettings({ autoLoc: e.target.checked });
              if (e.target.checked) useMyLocation(true);
            }}
          />
        </label>
      </div>

      <h4 className="azan-sec">Prayer Settings</h4>
      <div className="azan-cards">
        <label className="azan-setrow">
          <span className="azan-set-ic">🕌</span>
          <span className="azan-set-main">Juristic Method</span>
          <select
            value={settings.school}
            onChange={(e) => saveSettings({ school: Number(e.target.value) })}
          >
            <option value={1}>Hanafi</option>
            <option value={0}>Shafi</option>
          </select>
        </label>
        <label className="azan-setrow">
          <span className="azan-set-ic">🏙️</span>
          <span className="azan-set-main">Calculation Method</span>
          <select
            value={settings.method}
            onChange={(e) => saveSettings({ method: Number(e.target.value) })}
          >
            {METHODS.map((m) => (
              <option key={m.v} value={m.v}>
                {m.l}
              </option>
            ))}
          </select>
        </label>
        <label className="azan-setrow">
          <span className="azan-set-ic">📅</span>
          <span className="azan-set-main">Hijri Adjustment</span>
          <select
            value={settings.hijriAdj}
            onChange={(e) => saveSettings({ hijriAdj: Number(e.target.value) })}
          >
            {[-2, -1, 0, 1, 2].map((d) => (
              <option key={d} value={d}>
                {d > 0 ? `+${d}` : d} Day
              </option>
            ))}
          </select>
        </label>
      </div>

      <h4 className="azan-sec">Notifications</h4>
      <div className="azan-cards">
        <label className="azan-setrow switch-row">
          <span className="azan-set-ic">🔔</span>
          <span className="azan-set-main">Prayer Alerts</span>
          <input
            type="checkbox"
            checked={settings.alertsOn}
            onChange={(e) => enableAlerts({ alertsOn: e.target.checked })}
          />
        </label>
      </div>
      <p className="info-sub azan-note">
        {methodName} calculation · {settings.school === 1 ? 'Hanafi' : 'Shafi'} Asr · Alerts ring
        while ConnectX is open on this device.
      </p>
    </div>
  );
}
