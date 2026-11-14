import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { usePrefs } from '../context/PreferencesContext';
import { formatDayLabel, formatHourLabel, weatherEmoji } from '../utils/weather';

// Weather page (module 26). Data comes from our own /api/weather endpoints
// (Open-Meteo, no key). Cities the user saves live in their preferences.
export default function Weather() {
  const { prefs, save } = usePrefs();
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [geoNote, setGeoNote] = useState('');

  const savedCities = prefs?.weatherCities || [];

  const load = useCallback(async (params) => {
    setBusy(true);
    setError('');
    try {
      const qs = new URLSearchParams(params).toString();
      const [c, f] = await Promise.all([
        api(`/api/weather/current?${qs}`),
        api(`/api/weather/forecast?${qs}`),
      ]);
      setCurrent(c);
      setForecast(f);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Open with the first saved city, if any.
  useEffect(() => {
    if (savedCities.length > 0 && !current) {
      const c = savedCities[0];
      load({ lat: String(c.latitude), lon: String(c.longitude), name: c.name || '', country: c.country || '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCities.length]);

  function search(e) {
    e.preventDefault();
    const city = query.trim();
    if (!city) return;
    load({ city });
  }

  function useMyLocation() {
    setGeoNote('');
    if (!navigator.geolocation) {
      setGeoNote('Is browser mein location ki sahulat nahi hai — city search kar lo.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        load({
          lat: String(pos.coords.latitude),
          lon: String(pos.coords.longitude),
          name: 'My location',
        });
      },
      () => {
        setBusy(false);
        setGeoNote('Location nahi mili — phone ki Location ON karke dobara try karo, ya city search kar lo.');
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
  }

  async function saveCurrentCity() {
    if (!current?.location) return;
    const loc = current.location;
    if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return;
    const entry = {
      name: loc.name || 'My location',
      country: loc.country || '',
      latitude: loc.latitude,
      longitude: loc.longitude,
    };
    const exists = savedCities.some(
      (c) =>
        Math.abs(c.latitude - entry.latitude) < 0.01 && Math.abs(c.longitude - entry.longitude) < 0.01
    );
    if (exists) return;
    await save({ weatherCities: [...savedCities, entry] }).catch((err) => setError(err.message));
  }

  async function removeCity(city) {
    await save({
      weatherCities: savedCities.filter(
        (c) => !(c.latitude === city.latitude && c.longitude === city.longitude)
      ),
    }).catch(() => {});
  }

  const c = current?.current;
  const isSaved =
    current &&
    savedCities.some(
      (s) =>
        Math.abs(s.latitude - current.location.latitude) < 0.01 &&
        Math.abs(s.longitude - current.location.longitude) < 0.01
    );

  return (
    <div className="page-shell wide">
      <header className="page-header">
        <Link to="/home" className="icon-btn">←</Link>
        <h2>Weather</h2>
      </header>

      <form className="weather-search" onSubmit={search}>
        <input
          className="text-input"
          placeholder="Search a city — e.g. Peshawar, Dubai, London"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={busy}>
          Search
        </button>
        <button className="btn ghost" type="button" onClick={useMyLocation} disabled={busy}>
          📍 Use my location
        </button>
      </form>
      {geoNote && <p className="info-sub">{geoNote}</p>}
      {error && <p className="form-error">{error}</p>}

      {savedCities.length > 0 && (
        <div className="city-chips">
          {savedCities.map((city) => (
            <span className="city-chip" key={`${city.latitude},${city.longitude}`}>
              <button
                className="city-chip-main"
                onClick={() =>
                  load({
                    lat: String(city.latitude),
                    lon: String(city.longitude),
                    name: city.name || '',
                    country: city.country || '',
                  })
                }
              >
                {city.name}
                {city.country ? `, ${city.country}` : ''}
              </button>
              <button className="city-chip-x" onClick={() => removeCity(city)} title="Remove city">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {busy && !current && (
        <div className="profile-card" aria-busy="true">
          <div className="skeleton line w40" />
          <div className="skeleton line w60" />
          <div className="skeleton line w80" />
        </div>
      )}

      {c && (
        <>
          <div className="profile-card weather-now">
            <div className="weather-now-main">
              <span className="ww-emoji big">{weatherEmoji(c.weatherCode)}</span>
              <div>
                <div className="weather-temp">{Math.round(c.temperature)}°C</div>
                <div className="info-sub">
                  {current.location.name}
                  {current.location.country ? `, ${current.location.country}` : ''} · {c.condition}
                </div>
              </div>
              {!isSaved && (
                <button className="btn small primary weather-save" onClick={saveCurrentCity}>
                  ☆ Save city
                </button>
              )}
            </div>
            <div className="weather-stats">
              <div className="weather-stat">
                <span className="ws-value">{Math.round(c.feelsLike)}°C</span>
                <span className="ws-label">Feels like</span>
              </div>
              <div className="weather-stat">
                <span className="ws-value">{c.humidity}%</span>
                <span className="ws-label">Humidity</span>
              </div>
              <div className="weather-stat">
                <span className="ws-value">{Math.round(c.windSpeed)} km/h</span>
                <span className="ws-label">Wind</span>
              </div>
            </div>
          </div>

          {forecast && (
            <div className="profile-card">
              <h3>Next 24 hours</h3>
              <div className="hourly-strip">
                {forecast.hourly.map((h) => (
                  <div className="hour-cell" key={h.time}>
                    <span className="hour-label">{formatHourLabel(h.time)}</span>
                    <span className="hour-emoji">{weatherEmoji(h.weatherCode)}</span>
                    <span className="hour-temp">{Math.round(h.temperature)}°</span>
                  </div>
                ))}
              </div>
              <h3>7-day forecast</h3>
              <div className="daily-list">
                {forecast.daily.map((d) => (
                  <div className="daily-row" key={d.date}>
                    <span className="daily-day">{formatDayLabel(d.date)}</span>
                    <span className="daily-cond">
                      {weatherEmoji(d.weatherCode)} {d.condition}
                    </span>
                    <span className="daily-temps">
                      <span className="dim">{Math.round(d.min)}°</span> / <strong>{Math.round(d.max)}°</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="info-sub">Data: Open-Meteo (free, no account needed). Updated via a 10-minute server cache.</p>
        </>
      )}

      {!busy && !current && !error && (
        <div className="profile-card">
          <p className="empty-note">Search for a city or use your location to see the weather.</p>
        </div>
      )}
    </div>
  );
}
