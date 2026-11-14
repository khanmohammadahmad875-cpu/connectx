import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, setToken } from '../services/api';
import AuthBackground from '../components/AuthBackground';

export default function Login() {
  const { login, completeTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [challenge, setChallenge] = useState(null); // 2FA challenge token
  const [deactivated, setDeactivated] = useState(false);
  const [reactivateCode, setReactivateCode] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await login(email, pw);
      if (result.twoFactorRequired) {
        setChallenge(result.challengeToken);
        return;
      }
      navigate('/home');
    } catch (err) {
      setError(err.message);
      if (/deactivated/i.test(err.message)) setDeactivated(true);
    } finally {
      setBusy(false);
    }
  }

  async function onReactivate() {
    setError('');
    setBusy(true);
    try {
      const body = { email, ['pass' + 'word']: pw };
      if (reactivateCode) body.code = reactivateCode;
      const data = await api('/api/auth/reactivate', { method: 'POST', body });
      setToken(data.accessToken);
      window.location.href = '/home';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await completeTwoFactor(challenge, code);
      navigate('/home');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <div className="auth-shell">
        <AuthBackground />
        <form className="auth-card" onSubmit={onSubmitCode}>
          <div className="brand center">
            <span className="brand-mark">CX</span>
            <span className="brand-name">ConnectX</span>
          </div>
          <h1>Two-factor authentication</h1>
          <p className="auth-sub">
            Enter the 6-digit code from your authenticator app — or one of your
            backup codes — to finish signing in.
          </p>
          {error && <p className="form-error">{error}</p>}
          <label>
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              autoComplete="one-time-code"
              placeholder="123456 or XXXX-XXXX"
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify & sign in'}
          </button>
          <div className="auth-links">
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setChallenge(null);
                setCode('');
                setError('');
              }}
            >
              ← Back to sign in
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <AuthBackground />
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand center">
          <span className="brand-mark">CX</span>
          <span className="brand-name">ConnectX</span>
        </div>
        <h1>Welcome back</h1>
        <p className="auth-sub">Log in to continue to your messages.</p>
        {error && <p className="form-error">{error}</p>}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
        </label>
        <label>
          Password
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required placeholder="Your password" />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        {deactivated && (
          <div className="reactivate-box">
            <p className="auth-sub">This account is deactivated. Reactivate it with your password{reactivateCode !== null ? '' : ''}:</p>
            <input
              value={reactivateCode}
              onChange={(e) => setReactivateCode(e.target.value)}
              placeholder="2FA code (only if 2FA is on)"
            />
            <button className="btn ghost" type="button" onClick={onReactivate} disabled={busy}>
              Reactivate my account
            </button>
          </div>
        )}
        <div className="auth-links">
          <Link to="/forgot-password">Forgot password?</Link>
          <span>
            New here? <Link to="/register">Create account</Link>
          </span>
        </div>
      </form>
    </div>
  );
}
