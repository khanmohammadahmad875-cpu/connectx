import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../services/api';
import { ACCENTS, DEFAULT_PREFS } from '../utils/wallpapers';

// Server-persisted user preferences (wallpaper, accent, saved weather/clock
// cities — v3.0 modules 25–27). Loads after login; saves go through
// PATCH /api/users/me/preferences and the returned copy becomes the state.
const PreferencesContext = createContext({ prefs: null, save: async () => null, loading: true });

export function PreferencesProvider({ children }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const userId = user?._id;

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setPrefs(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    api('/api/users/me/preferences')
      .then((data) => {
        if (!cancelled) setPrefs({ ...DEFAULT_PREFS, ...(data.preferences || {}) });
      })
      .catch(() => {
        if (!cancelled) setPrefs({ ...DEFAULT_PREFS });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Apply the theme (light/dark/system) app-wide. The CSS :root palette is
  // the light WhatsApp theme; [data-theme='dark'] carries the dark palette.
  useEffect(() => {
    const root = document.documentElement;
    const choice = prefs?.theme || 'light';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      root.dataset.theme = choice === 'system' ? (mq.matches ? 'dark' : 'light') : choice;
    };
    apply();
    if (choice === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    return undefined;
  }, [prefs?.theme]);

  // Apply the chosen accent color app-wide via the theme CSS variables.
  // The legacy default '#2f7bff' means "never explicitly chosen": leave the
  // variables unset so each theme's own default applies (WhatsApp green in
  // light, blue in dark).
  useEffect(() => {
    const root = document.documentElement;
    if (!prefs?.accentColor || prefs.accentColor === '#2f7bff') {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-dark');
      return undefined;
    }
    const accent = ACCENTS.find((a) => a.value === prefs.accentColor);
    root.style.setProperty('--accent', prefs.accentColor);
    root.style.setProperty('--accent-dark', accent ? accent.dark : prefs.accentColor);
    return () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-dark');
    };
  }, [prefs?.accentColor]);

  // Chat font size (accessibility) + the app-wide Animations on/off switch.
  useEffect(() => {
    const root = document.documentElement;
    const sizes = { small: '13.5px', medium: '14.5px', large: '16.5px' };
    root.style.setProperty(
      '--msg-font-size',
      prefs?.easyMode ? '17.5px' : sizes[prefs?.fontSize] || sizes.medium
    );
    if (prefs?.animationsEnabled === false) root.dataset.animations = 'off';
    else delete root.dataset.animations;
    if (prefs?.easyMode) root.dataset.easy = 'on';
    else delete root.dataset.easy;
  }, [prefs?.fontSize, prefs?.animationsEnabled, prefs?.easyMode]);

  // App-wide font style (Settings → Accessibility): drives the --app-font
  // CSS variable that the base body rule reads.
  useEffect(() => {
    const root = document.documentElement;
    const stacks = {
      default: "'Segoe UI', system-ui, -apple-system, Arial, sans-serif",
      classic: "Georgia, 'Times New Roman', Times, serif",
      modern: "'Trebuchet MS', 'Segoe UI', Verdana, sans-serif",
      rounded: "Verdana, Geneva, Tahoma, sans-serif",
      elegant: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
      mono: "'Cascadia Code', Consolas, 'Courier New', monospace",
    };
    root.style.setProperty('--app-font', stacks[prefs?.fontFamily] || stacks.default);
  }, [prefs?.fontFamily]);

  const save = useCallback(async (partial) => {
    const data = await api('/api/users/me/preferences', { method: 'PATCH', body: partial });
    setPrefs({ ...DEFAULT_PREFS, ...(data.preferences || {}) });
    return data.preferences;
  }, []);

  return (
    <PreferencesContext.Provider value={{ prefs, save, loading }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePrefs() {
  return useContext(PreferencesContext);
}
