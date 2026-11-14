import { useEffect, useState } from 'react';
import { LocationMap } from './LocationView';

const LIVE_CHOICES = [
  { label: '15 minutes', durationSec: 900 },
  { label: '1 hour', durationSec: 3600 },
  { label: '8 hours', durationSec: 28800 },
];

// Share-location sheet (module 29). Geolocation is requested ONLY here —
// after the user explicitly tapped the 📍 button and this sheet opened.
// Nothing about the user's position is read automatically anywhere.
export default function LocationPicker({ onSendLocation, onStartLive, onClose }) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('once'); // 'once' | 'live'
  const [durationSec, setDurationSec] = useState(3600);
  const [label, setLabel] = useState('');

  function findMe() {
    setError('');
    if (!navigator.geolocation) {
      setError('Is browser mein location ki sahulat nahi hai.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () =>
        setError(
          'Location nahi mili — phone ki Location ON karo aur app ko location ki permission do, phir dobara try karo.'
        ),
      { enableHighAccuracy: false, timeout: 12000 }
    );
  }

  useEffect(() => {
    findMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm() {
    if (!position) return;
    setBusy(true);
    setError('');
    try {
      const payload = { ...position, label: label.trim() };
      if (mode === 'once') await onSendLocation(payload);
      else await onStartLive({ ...payload, durationSec });
      onClose();
    } catch (err) {
      setError(err.message || 'Could not share the location.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📍 Share location</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {error && !position && (
          <button type="button" className="btn" onClick={findMe}>
            📍 Dobara try karo
          </button>
        )}
        {!position && !error && <p className="empty-note">Getting your location…</p>}
        {position && (
          <>
            <LocationMap latitude={position.latitude} longitude={position.longitude} height={220} />
            <div className="loc-mode-row">
              <button
                className={`section-tab ${mode === 'once' ? 'active' : ''}`}
                onClick={() => setMode('once')}
              >
                Send current location
              </button>
              <button
                className={`section-tab ${mode === 'live' ? 'active' : ''}`}
                onClick={() => setMode('live')}
              >
                Share live location
              </button>
            </div>
            {mode === 'live' && (
              <div className="loc-duration-row">
                {LIVE_CHOICES.map((c) => (
                  <label key={c.durationSec} className="radio-chip">
                    <input
                      type="radio"
                      name="live-duration"
                      checked={durationSec === c.durationSec}
                      onChange={() => setDurationSec(c.durationSec)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
            <label className="modal-label">
              Label (optional)
              <input
                className="text-input"
                value={label}
                maxLength={120}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Office, Home…"
              />
            </label>
            <p className="info-sub">
              {mode === 'live'
                ? 'Your live location updates while you share and stops automatically when the time runs out. You can stop earlier from the message.'
                : 'Sends a single pin with your current position.'}
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={confirm} disabled={busy}>
                {busy ? 'Sharing…' : mode === 'live' ? 'Start sharing' : 'Send location'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
