import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { usePrefs } from '../context/PreferencesContext';
import { weatherEmoji } from '../utils/weather';

// Dashboard weather widget (module 26): current conditions for the user's
// first saved city, served by our own /api/weather proxy over Open-Meteo.
export default function WeatherWidget() {
  const { prefs } = usePrefs();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const city = (prefs?.weatherCities || [])[0];

  useEffect(() => {
    let cancelled = false;
    if (!city) {
      setData(null);
      return undefined;
    }
    api(
      `/api/weather/current?lat=${city.latitude}&lon=${city.longitude}&name=${encodeURIComponent(
        city.name || ''
      )}&country=${encodeURIComponent(city.country || '')}`
    )
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [city]);

  if (!city) {
    return (
      <div className="weather-widget">
        <p className="empty-note">No city saved yet.</p>
        <Link className="btn small primary" to="/weather">
          Set up weather
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="weather-widget">
        <p className="empty-note">Weather unavailable: {error}</p>
        <Link className="btn small ghost" to="/weather">
          Open weather
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="weather-widget" aria-busy="true">
        <div className="skeleton line w60" />
        <div className="skeleton line w40" />
        <div className="skeleton line w80" />
      </div>
    );
  }

  const c = data.current;
  return (
    <Link className="weather-widget weather-link" to="/weather">
      <div className="ww-main">
        <span className="ww-emoji">{weatherEmoji(c.weatherCode)}</span>
        <span className="ww-temp">{Math.round(c.temperature)}°</span>
      </div>
      <div className="ww-meta">
        <span className="ww-city">
          {data.location.name || city.name}
          {data.location.country ? `, ${data.location.country}` : ''}
        </span>
        <span className="ww-cond">
          {c.condition} · feels {Math.round(c.feelsLike)}° · humidity {c.humidity}%
        </span>
      </div>
    </Link>
  );
}
