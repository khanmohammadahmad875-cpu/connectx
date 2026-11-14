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

  // Apply the chosen accent color app-wide via the theme CSS variables.
  useEffect(() => {
    const root = document.documentElement;
    if (!prefs?.accentColor) return undefined;
    const accent = ACCENTS.find((a) => a.value === prefs.accentColor);
    root.style.setProperty('--accent', prefs.accentColor);
    root.style.setProperty('--accent-dark', accent ? accent.dark : prefs.accentColor);
    return () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-dark');
    };
  }, [prefs?.accentColor]);

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
