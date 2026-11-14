import { useEffect, useState } from 'react';
import { usePrefs } from '../context/PreferencesContext';
import { TIMEZONES, dateInZone, localTimeZone, timeInZone, zoneLabel } from '../utils/timezones';
import { storedGeoName } from '../utils/geo';

// World clock (module 27): local time + the user's saved cities. Everything
// is computed locally with Intl; saved cities and the 12/24h choice persist
// in the user's server-side preferences.
export default function WorldClock({ editable = false }) {
  const { prefs, save } = usePrefs();
  const [now, setNow] = useState(() => new Date());
  const [adding, setAdding] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  const format24h = !!prefs?.clockFormat24h;
  const cities = prefs?.clockCities || [];
  const myZone = localTimeZone();

  async function addCity() {
    if (!adding) return;
    const found = TIMEZONES.find((z) => z.timeZone === adding);
    if (!found) return;
    await save({
      clockCities: [...cities, { label: found.label, timeZone: found.timeZone }],
    }).catch(() => {});
    setAdding('');
  }

  async function removeCity(timeZone) {
    await save({ clockCities: cities.filter((c) => c.timeZone !== timeZone) }).catch(() => {});
  }

  async function toggleFormat() {
    await save({ clockFormat24h: !format24h }).catch(() => {});
  }

  const available = TIMEZONES.filter(
    (z) => z.timeZone !== myZone && !cities.some((c) => c.timeZone === z.timeZone)
  );

  return (
    <div className="world-clock">
      <div className="wc-row wc-local">
        <span className="wc-place">
          <span className="wc-name">{storedGeoName() ? `📍 ${storedGeoName()}` : 'Local time'}</span>
          <span className="wc-zone">{zoneLabel(myZone)}</span>
        </span>
        <span className="wc-time">
          {timeInZone(myZone, now, format24h)}
          <span className="wc-date">{dateInZone(myZone, now)}</span>
        </span>
      </div>
      {cities.map((c) => (
        <div className="wc-row" key={c.timeZone}>
          <span className="wc-place">
            <span className="wc-name">{c.label || zoneLabel(c.timeZone)}</span>
            <span className="wc-zone">{dateInZone(c.timeZone, now)}</span>
          </span>
          <span className="wc-time small">{timeInZone(c.timeZone, now, format24h)}</span>
          {editable && (
            <button className="mini-btn danger" onClick={() => removeCity(c.timeZone)} title="Remove city">
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (
        <div className="wc-controls">
          <select className="text-input wc-select" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a city…</option>
            {available.map((z) => (
              <option key={z.timeZone} value={z.timeZone}>
                {z.label}
              </option>
            ))}
          </select>
          <button className="btn small primary" onClick={addCity} disabled={!adding}>
            Add
          </button>
          <button className="btn small ghost" onClick={toggleFormat}>
            {format24h ? '24h' : '12h'}
          </button>
        </div>
      )}
    </div>
  );
}
