import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthBackground from '../components/AuthBackground';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(username, email, password);
      navigate('/home');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <AuthBackground />
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand center">
          <span className="brand-mark">CX</span>
          <span className="brand-text"><span className="brand-name">ConnectX</span><span className="brand-sub">by Developer Mohammad Ahmad Khan</span></span>
        </div>
        <h1>Create your account</h1>
        <p className="auth-sub">Secure messaging, no noise. Passwords are hashed, always.</p>
        {error && <p className="form-error">{error}</p>}
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} placeholder="e.g. ahmad" />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <div className="auth-links">
          <span>
            Already have an account? <Link to="/login">Log in</Link>
          </span>
        </div>
      </form>
    </div>
  );
}
