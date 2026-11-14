// Map provider configuration (module 29) — the single place the tile
// provider lives, so OpenStreetMap can be swapped for another Leaflet
// tile source by changing these two values (VITE_MAP_TILE_URL /
// VITE_MAP_ATTRIBUTION at build time).
export const MAP_CONFIG = {
  tileUrl:
    import.meta.env.VITE_MAP_TILE_URL ||
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    import.meta.env.VITE_MAP_ATTRIBUTION ||
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

export function directionsUrl(latitude, longitude) {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}
