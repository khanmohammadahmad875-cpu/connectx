import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_CONFIG, directionsUrl } from '../../utils/maps';

// Leaflet map over OpenStreetMap tiles (module 29). A divIcon pin avoids
// the broken default-marker asset paths in bundled builds.
const pinIcon = L.divIcon({
  className: 'loc-pin',
  html: '<span class="loc-pin-emoji">📍</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 28],
});

export function LocationMap({ latitude, longitude, height = 180, interactive = false }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return undefined;
    const map = L.map(elRef.current, {
      attributionControl: true,
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
    }).setView([latitude, longitude], 15);
    L.tileLayer(MAP_CONFIG.tileUrl, {
      attribution: MAP_CONFIG.attribution,
      maxZoom: 19,
    }).addTo(map);
    markerRef.current = L.marker([latitude, longitude], { icon: pinIcon }).addTo(map);
    mapRef.current = map;
    // Leaflet needs a size recalculation once the bubble has laid out.
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mapRef.current && markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude]);
      mapRef.current.setView([latitude, longitude], mapRef.current.getZoom(), { animate: true });
    }
  }, [latitude, longitude]);

  return <div ref={elRef} className="loc-map" style={{ height }} aria-label="Map preview" />;
}

// Full-screen map (tap a location bubble): larger interactive map plus a
// Directions hand-off to Google Maps.
export function LocationModal({ latitude, longitude, label, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card location-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📍 {label || 'Location'}</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <LocationMap latitude={latitude} longitude={longitude} height={380} interactive />
        <div className="location-modal-actions">
          <span className="info-sub">
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </span>
          <a
            className="btn small primary"
            href={directionsUrl(latitude, longitude)}
            target="_blank"
            rel="noreferrer"
          >
            Directions ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// A rendered location inside a message bubble: mini map + label + actions.
export default function LocationView({ location, live = null, onStopLive = null }) {
  const [showFull, setShowFull] = useState(false);
  const data = live || location;
  if (!data) return null;
  const { latitude, longitude, label } = data;
  const stopped = live ? !!live.stoppedAt || new Date(live.expiresAt) <= new Date() : false;
  const remainingMs = live ? new Date(live.expiresAt).getTime() - Date.now() : 0;
  const remainingMin = Math.max(0, Math.round(remainingMs / 60000));

  return (
    <div className="location-bubble">
      <button className="location-map-btn" onClick={() => setShowFull(true)} title="Open map">
        <LocationMap latitude={latitude} longitude={longitude} height={170} />
      </button>
      <div className="location-meta">
        <span className="location-label">
          {live ? (stopped ? '📍 Live location ended' : `🔴 Live location · ${remainingMin} min left`) : `📍 ${label || 'Location'}`}
        </span>
        <span className="location-actions">
          <a href={directionsUrl(latitude, longitude)} target="_blank" rel="noreferrer">
            Directions ↗
          </a>
          {live && !stopped && onStopLive && (
            <button className="mini-btn danger" onClick={onStopLive}>
              Stop sharing
            </button>
          )}
        </span>
      </div>
      {live && !stopped && !onStopLive && (
        <p className="location-note">Sharing live location…</p>
      )}
      {showFull && (
        <LocationModal
          latitude={latitude}
          longitude={longitude}
          label={label || (live ? 'Live location' : 'Location')}
          onClose={() => setShowFull(false)}
        />
      )}
    </div>
  );
}
