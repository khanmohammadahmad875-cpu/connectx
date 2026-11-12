import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword } });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand center">
          <span className="brand-mark">CX</span>
          <span className="brand-name">ConnectX</span>
        </div>
        <h1>Choose a new password</h1>
        {done ? (
          <p className="auth-sub">
            Password reset complete. <Link to="/login">Log in</Link> with your new password.
          </p>
        ) : (
          <>
            {error && <p className="form-error">{error}</p>}
            {!token && <p className="form-error">This link is missing its token.</p>}
            <label>
              New password
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
            </label>
            <button className="btn primary" type="submit" disabled={!token}>Reset password</button>
          </>
        )}
        <div className="auth-links">
          <Link to="/login">Back to login</Link>
        </div>
      </form>
    </div>
  );
}
