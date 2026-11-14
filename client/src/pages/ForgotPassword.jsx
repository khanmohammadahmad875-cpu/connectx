import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import AuthBackground from '../components/AuthBackground';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setDone(true);
    } catch (err) {
      setError(err.message);
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
        <h1>Reset password</h1>
        {done ? (
          <p className="auth-sub">
            If that email is registered, a reset link is on its way. Please check your
            inbox (and spam folder) — the link works for 30 minutes.
          </p>
        ) : (
          <>
            <p className="auth-sub">Enter your account email and we will send a reset link.</p>
            {error && <p className="form-error">{error}</p>}
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <button className="btn primary" type="submit">Send reset link</button>
          </>
        )}
        <div className="auth-links">
          <Link to="/login">Back to login</Link>
        </div>
      </form>
    </div>
  );
}
