import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, setToken, uploadFile } from '../services/api';
import { disconnectSocket } from '../socket/socket';
import Avatar from '../components/Avatar';

export default function Profile() {
  const { user: me, setUser } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState(me.username || '');
  const [bio, setBio] = useState(me.bio || '');
  const [privacy, setPrivacy] = useState({
    showLastSeen: me.privacy?.showLastSeen !== false,
    showProfilePicture: me.privacy?.showProfilePicture !== false,
  });
  const [blocked, setBlocked] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    api('/api/users/me/blocks')
      .then((data) => setBlocked(data.blocked || []))
      .catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      const data = await api('/api/users/me', {
        method: 'PATCH',
        body: { username: username.trim(), bio, privacy },
      });
      setUser(data.user);
      setNote('Profile saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changePicture(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const result = await uploadFile(file);
      const data = await api('/api/users/me', {
        method: 'PATCH',
        body: { profilePicture: result.url },
      });
      setUser(data.user);
      setNote('Profile picture updated.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function unblock(id) {
    await api(`/api/users/${id}/unblock`, { method: 'POST' });
    setBlocked((prev) => prev.filter((u) => u._id !== id));
  }

  async function deactivate() {
    if (
      !window.confirm(
        'Deactivate your account? You will be logged out and will no longer be able to log in.'
      )
    )
      return;
    try {
      await api('/api/auth/deactivate', { method: 'POST' });
    } catch (err) {
      /* account may already be deactivated */
    }
    disconnectSocket();
    setToken(null);
    setUser(null);
    navigate('/login');
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <Link to="/" className="icon-btn">←</Link>
        <h2>My profile</h2>
      </header>

      <div className="profile-card">
        <div className="profile-top">
          <Avatar name={me.username} src={me.profilePicture} size={84} />
          <div>
            <h3>{me.username}</h3>
            <p className="info-sub">{me.email}</p>
            <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
              Change picture
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={changePicture}
            />
          </div>
        </div>

        <form onSubmit={save} className="profile-form">
          {error && <p className="form-error">{error}</p>}
          {note && <p className="ok-note">{note}</p>}
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} />
          </label>
          <label>
            Bio
            <textarea rows={3} maxLength={200} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line about you…" />
          </label>
          <label className="switch-row">
            <span>Show my last seen &amp; online status</span>
            <input
              type="checkbox"
              checked={privacy.showLastSeen}
              onChange={(e) => setPrivacy((p) => ({ ...p, showLastSeen: e.target.checked }))}
            />
          </label>
          <label className="switch-row">
            <span>Show my profile picture</span>
            <input
              type="checkbox"
              checked={privacy.showProfilePicture}
              onChange={(e) => setPrivacy((p) => ({ ...p, showProfilePicture: e.target.checked }))}
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>

      <div className="profile-card">
        <h3>Blocked users</h3>
        {blocked.length === 0 && <p className="empty-note">You have not blocked anyone.</p>}
        {blocked.map((u) => (
          <div key={u._id} className="member-row">
            <Avatar name={u.username} src={u.profilePicture} size={32} />
            <span className="member-name">{u.username}</span>
            <button className="mini-btn" onClick={() => unblock(u._id)}>Unblock</button>
          </div>
        ))}
      </div>

      <div className="profile-card danger-zone">
        <h3>Danger zone</h3>
        <p className="info-sub">Deactivating stops logins for this account. This cannot be undone from the app.</p>
        <button className="btn danger" onClick={deactivate}>Deactivate account</button>
      </div>
    </div>
  );
}
