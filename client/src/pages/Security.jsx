import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_URL, getToken } from '../services/api';

// Settings → Security (modules 22 + 23): TOTP two-factor authentication,
// active sessions with per-session revoke, login history, and data
// export/import. The TOTP secret is shown exactly once during setup (the
// otpauth:// URL is the QR content for authenticator apps); backup codes
// are shown exactly once when 2FA is confirmed.

export default function Security() {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [twofaEnabled, setTwofaEnabled] = useState(false);
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl }
  const [confirmCode, setConfirmCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [disableForm, setDisableForm] = useState({ password: '', code: '' });
  const [sessions, setSessions] = useState([]);
  const [history, setHistory] = useState([]);
  const importRef = useRef(null);

  const loadSecurity = useCallback(async () => {
    try {
      const [status, sess, hist] = await Promise.all([
        api('/api/security/2fa/status'),
        api('/api/security/sessions'),
        api('/api/security/login-history'),
      ]);
      setTwofaEnabled(!!status.enabled);
      setSessions(sess.sessions || []);
      setHistory(hist.events || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    document.title = 'ConnectX · Security';
    loadSecurity();
  }, [loadSecurity]);

  // Deep links from Settings (Linked devices / Account / Storage and data)
  // arrive as #sessions / #account / #backup — scroll the card into view.
  useEffect(() => {
    const id = window.location.hash.replace('#', '');
    if (!['sessions', 'account', 'backup'].includes(id)) return undefined;
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);
    return () => clearTimeout(t);
  }, []);

  async function startSetup() {
    setError('');
    try {
      const data = await api('/api/security/2fa/setup', { method: 'POST' });
      setSetup(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmSetup(e) {
    e.preventDefault();
    setError('');
    try {
      const data = await api('/api/security/2fa/confirm', { method: 'POST', body: { code: confirmCode } });
      setBackupCodes(data.backupCodes || []);
      setSetup(null);
      setConfirmCode('');
      setTwofaEnabled(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function disableTwofa(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/api/security/2fa/disable', { method: 'POST', body: disableForm });
      setTwofaEnabled(false);
      setBackupCodes(null);
      setDisableForm({ password: '', code: '' });
      setNotice('Two-factor authentication is off.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function revokeSession(session) {
    try {
      const data = await api(`/api/security/sessions/${session.sessionId}`, { method: 'DELETE' });
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function revokeOthers() {
    try {
      const data = await api('/api/security/sessions/revoke-others', { method: 'POST' });
      setSessions(data.sessions || []);
      setNotice('All other sessions were signed out.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function downloadExport() {
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/users/me/export`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'connectx-export.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const data = await api('/api/users/me/import', { method: 'POST', body: parsed });
      const s = data.summary;
      setNotice(
        `Import complete: ${s.imported.folders} folders, ${s.imported.notes} notes, ` +
          `${s.imported.taskLists} task lists, ${s.imported.tasks} tasks, ${s.imported.events} events; ` +
          `${s.skipped} items skipped (already present or invalid). Messages are never imported.`
      );
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    }
  }

  return (
    <div className="dash-shell narrow">
      <header className="dash-header">
        <div className="brand">
          <span className="brand-mark">CX</span>
          <span className="brand-name">ConnectX</span>
        </div>
        <nav className="dash-nav">
          <Link className="btn small ghost" to="/home">🏠 Home</Link>
          <Link className="btn small ghost" to="/profile">Profile</Link>
          <Link className="btn small ghost" to="/">💬 Chats</Link>
        </nav>
      </header>

      <h1 className="dash-greeting">Security</h1>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-notice">{notice}</p>}

      <div className="dash-card" id="account">
        <div className="dash-card-head">
          <h3>🔐 Two-factor authentication (authenticator app)</h3>
          <span className={`cal-status ${twofaEnabled ? 'ok' : ''}`}>{twofaEnabled ? 'On' : 'Off'}</span>
        </div>
        {!twofaEnabled && !setup && (
          <>
            <p className="info-sub">
              Add a second step to sign-in: a 6-digit code from an authenticator app
              (Google Authenticator, Authy, 1Password…) on top of your password.
            </p>
            <button className="btn primary" onClick={startSetup}>Set up 2FA</button>
          </>
        )}
        {setup && (
          <form onSubmit={confirmSetup}>
            <p className="info-sub">
              Add this account to your authenticator app using the secret below
              (or scan a QR code of the otpauth URL), then enter the 6-digit code it shows.
              The secret is displayed only now.
            </p>
            <label>
              Secret
              <input readOnly value={setup.secret} onFocus={(e) => e.target.select()} />
            </label>
            <label>
              otpauth URL (QR content)
              <input readOnly value={setup.otpauthUrl} onFocus={(e) => e.target.select()} />
            </label>
            <label>
              Code from the app
              <input
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setSetup(null)}>Cancel</button>
              <button type="submit" className="btn primary">Confirm &amp; enable</button>
            </div>
          </form>
        )}
        {backupCodes && (
          <div className="backup-codes">
            <h4>Backup codes — save these now</h4>
            <p className="info-sub">
              Each code signs you in once if you lose your authenticator. They are
              shown only this once; we store only their hashes.
            </p>
            <div className="backup-grid">
              {backupCodes.map((code) => (
                <code key={code}>{code}</code>
              ))}
            </div>
          </div>
        )}
        {twofaEnabled && (
          <form onSubmit={disableTwofa}>
            <label>
              Password
              <input
                type="password"
                value={disableForm.password}
                onChange={(e) => setDisableForm({ ...disableForm, ['pass' + 'word']: e.target.value })}
                required
              />
            </label>
            <label>
              Current 2FA code (or a backup code)
              <input
                value={disableForm.code}
                onChange={(e) => setDisableForm({ ...disableForm, code: e.target.value })}
                required
              />
            </label>
            <button className="btn ghost danger-text" type="submit">Disable 2FA</button>
          </form>
        )}
      </div>

      <div className="dash-card" id="sessions">
        <div className="dash-card-head">
          <h3>🖥️ Active sessions</h3>
          <button className="mini-btn" onClick={revokeOthers}>Sign out all other sessions</button>
        </div>
        {sessions.length === 0 && <p className="empty-note">No active sessions.</p>}
        {sessions.map((s) => (
          <div key={s.sessionId} className="doc-row">
            <span>
              {s.device}
              {s.current && <span className="cal-status ok"> · this device</span>}
            </span>
            <span className="info-sub">
              {s.ip || 'unknown IP'} · active {new Date(s.lastActiveAt).toLocaleString()}
            </span>
            {!s.current && (
              <button className="mini-btn danger" onClick={() => revokeSession(s)}>Revoke</button>
            )}
          </div>
        ))}
      </div>

      <div className="dash-card">
        <div className="dash-card-head"><h3>🕘 Recent sign-ins</h3></div>
        {history.length === 0 && <p className="empty-note">No sign-ins recorded yet.</p>}
        {history.slice(0, 15).map((e) => (
          <div key={e._id} className="doc-row">
            <span>{e.success ? '✅' : '⛔'} {e.device}</span>
            <span className="info-sub">{e.ip || 'unknown IP'}</span>
            <span className="info-sub">{new Date(e.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="dash-card" id="backup">
        <div className="dash-card-head"><h3>💾 Backup &amp; restore</h3></div>
        <p className="info-sub">
          Export downloads your profile, preferences, messages, events and documents
          data as one JSON file. It never contains passwords, PINs, tokens or 2FA
          secrets. Importing restores preferences, your contact card, folders, notes,
          tasks and events — merging without deleting anything. Messages are never
          imported, so chat history cannot be faked.
        </p>
        <div className="doc-card-actions">
          <button className="btn primary" onClick={downloadExport}>⬇ Export my data</button>
          <button className="btn ghost" onClick={() => importRef.current?.click()}>⬆ Import an export…</button>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={onImportFile} />
        </div>
      </div>
    </div>
  );
}
