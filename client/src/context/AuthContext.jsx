import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, API_URL, getToken, setToken } from '../services/api';
import { connectSocket, disconnectSocket } from '../socket/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const data = await api('/api/users/me');
    setUser(data.user);
    connectSocket();
    return data.user;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (getToken()) {
          await loadMe();
        } else {
          // No stored token: try the refresh cookie (returning session).
          const res = await fetch(`${API_URL}/api/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
          });
          if (res.ok) {
            const data = await res.json();
            setToken(data.accessToken);
            setUser(data.user);
            connectSocket();
          }
        }
      } catch (err) {
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadMe]);

  // Returns { user } on success, or { twoFactorRequired: true,
  // challengeToken } when the account has 2FA on (module 22) — the caller
  // then collects a code and calls completeTwoFactor.
  const login = useCallback(async (email, password) => {
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    if (data.twoFactorRequired) {
      return { twoFactorRequired: true, challengeToken: data.challengeToken };
    }
    setToken(data.accessToken);
    setUser(data.user);
    connectSocket();
    return { user: data.user };
  }, []);

  const completeTwoFactor = useCallback(async (challengeToken, code) => {
    const data = await api('/api/auth/login/2fa', {
      method: 'POST',
      body: { challengeToken, code },
    });
    setToken(data.accessToken);
    setUser(data.user);
    connectSocket();
    return data.user;
  }, []);

  const register = useCallback(async (username, email, password) => {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: { username, email, password },
    });
    setToken(data.accessToken);
    setUser(data.user);
    connectSocket();
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      /* logout is best-effort */
    }
    disconnectSocket();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, setUser, loading, login, completeTwoFactor, register, logout, loadMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
