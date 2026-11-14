// Built-in chat wallpapers (module 25): pure CSS gradients/patterns — no
// external images, so they work offline and weigh nothing. "custom" uses the
// user's own uploaded image (via the uploads pipeline).

export const WALLPAPERS = [
  { key: 'live-weather', name: 'Live Weather', css: null, live: true },
  { key: 'plain', name: 'Plain', css: '' },
  { key: 'midnight', name: 'Midnight', css: 'linear-gradient(160deg, #0b1220 0%, #16294d 55%, #0b1220 100%)' },
  { key: 'ocean', name: 'Ocean', css: 'linear-gradient(160deg, #052635 0%, #0b5563 60%, #052635 100%)' },
  { key: 'sunset', name: 'Sunset', css: 'linear-gradient(160deg, #2b1030 0%, #7a2d4d 55%, #c65a2e 100%)' },
  { key: 'forest', name: 'Forest', css: 'linear-gradient(160deg, #081c12 0%, #14532d 60%, #081c12 100%)' },
  { key: 'violet', name: 'Violet', css: 'linear-gradient(160deg, #17102e 0%, #3b2a6d 60%, #17102e 100%)' },
  { key: 'ember', name: 'Ember', css: 'linear-gradient(160deg, #200d06 0%, #6e2b10 60%, #200d06 100%)' },
  {
    key: 'dots',
    name: 'Dots',
    css: 'radial-gradient(rgba(140, 170, 255, 0.22) 1.5px, transparent 1.6px) 0 0 / 22px 22px, #0d1730',
  },
  {
    key: 'grid',
    name: 'Grid',
    css: 'linear-gradient(rgba(120, 150, 220, 0.13) 1px, transparent 1px) 0 0 / 100% 26px, linear-gradient(90deg, rgba(120, 150, 220, 0.13) 1px, transparent 1px) 0 0 / 26px 100%, #0d1730',
  },
  { key: 'custom', name: 'Custom image', css: null },
];

export const ACCENTS = [
  { name: 'WhatsApp', value: '#00a884', dark: '#008069' },
  { name: 'Blue', value: '#2f7bff', dark: '#1f5fe0' },
  { name: 'Violet', value: '#8b5cf6', dark: '#6d3fd4' },
  { name: 'Teal', value: '#14b8a6', dark: '#0d9488' },
  { name: 'Green', value: '#22c55e', dark: '#16a34a' },
  { name: 'Orange', value: '#f97316', dark: '#ea580c' },
  { name: 'Pink', value: '#ec4899', dark: '#db2777' },
  { name: 'Red', value: '#ef4444', dark: '#dc2626' },
];

export const DEFAULT_PREFS = {
  wallpaper: 'default',
  customWallpaperUrl: '',
  wallpaperDim: 45,
  accentColor: '#2f7bff',
  conversationWallpapers: [],
  weatherCities: [],
  clockCities: [],
  clockFormat24h: false,
  // WhatsApp-style polish: light is the product default theme.
  theme: 'light',
  liveWeatherBackground: true,
  fontSize: 'medium',
  fontFamily: 'default',
  easyMode: false,
  animationsEnabled: true,
  notificationPreviews: true,
  soundAlerts: true,
  defaultDisappearingDuration: 0,
  reelInterests: [],
};

// The stored key 'default' is the untouched system default (the server has
// always defaulted to it): those users have never explicitly chosen a
// wallpaper, so they get the Live Weather scene. Picking "Plain" stores the
// distinct 'plain' key, which is respected forever.
export function resolveWallpaperKey(key) {
  return key === 'default' || !key ? 'live-weather' : key;
}

// Resolve the effective wallpaper for a conversation: the per-conversation
// choice if one exists, otherwise the user's global default. The untouched
// 'default' key resolves to the Live Weather scene (see resolveWallpaperKey).
export function effectiveWallpaper(prefs, conversationId) {
  const p = prefs || DEFAULT_PREFS;
  const per = (p.conversationWallpapers || []).find((c) => c.conversationId === conversationId);
  if (per) {
    return {
      wallpaper: resolveWallpaperKey(per.wallpaper),
      customWallpaperUrl: per.customWallpaperUrl || '',
      dim: per.dim ?? 45,
      isCustom: true, // per-conversation override active
    };
  }
  return {
    wallpaper: resolveWallpaperKey(p.wallpaper),
    customWallpaperUrl: p.customWallpaperUrl || '',
    dim: p.wallpaperDim ?? 45,
    isCustom: false,
  };
}

// Inline style for the wallpaper layer behind a message list. 'plain' and
// 'live-weather' return null: plain is just the theme background, and the
// live scene is rendered by the WeatherScene component instead.
export function wallpaperLayerStyle(eff) {
  if (!eff || eff.wallpaper === 'plain' || eff.wallpaper === 'live-weather') return null;
  if (eff.wallpaper === 'custom') {
    if (!eff.customWallpaperUrl) return null;
    return {
      backgroundImage: `url("${eff.customWallpaperUrl}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  const found = WALLPAPERS.find((w) => w.key === eff.wallpaper);
  if (!found || !found.css) return null;
  return { background: found.css };
}

// Small preview style for a wallpaper swatch in pickers.
export function wallpaperSwatchStyle(key, customUrl) {
  if (key === 'live-weather') {
    return { background: 'linear-gradient(160deg, #79a6ff 0%, #bfe3ff 55%, #ffe9a8 130%)' };
  }
  if (key === 'plain') {
    return { background: 'linear-gradient(160deg, #9fb4d8 0%, #5f7ca6 100%)' };
  }
  if (key === 'custom') {
    return customUrl
      ? { backgroundImage: `url("${customUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { background: '#22304f' };
  }
  const found = WALLPAPERS.find((w) => w.key === key);
  if (!found || !found.css) return { background: '#111a2e' };
  return { background: found.css };
}
