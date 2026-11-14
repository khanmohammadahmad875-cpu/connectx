import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, setToken, uploadFile } from '../services/api';
import { disconnectSocket } from '../socket/socket';
import Avatar from '../components/Avatar';
import BusinessEditor from '../components/business/BusinessEditor';
import WallpaperPicker from '../components/WallpaperPicker';
import { usePrefs } from '../context/PreferencesContext';
import { ACCENTS } from '../utils/wallpapers';
import { TIMEZONES } from '../utils/timezones';
import { CONTACT_FIELD_META, visibilityOptionsFor } from '../utils/contactFields';

export default function Profile() {
  const { user: me, setUser } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState(me.username || '');
  const [bio, setBio] = useState(me.bio || '');
  const [privacy, setPrivacy] = useState({
    showLastSeen: me.privacy?.showLastSeen !== false,
    showProfilePicture: me.privacy?.showProfilePicture !== false,
  });
  const [timezone, setTimezone] = useState(me.timezone || '');
  const { prefs, save: savePrefs } = usePrefs();
  const [ccFields, setCcFields] = useState(null);
  const [ccVisibility, setCcVisibility] = useState(null);
  const [ccNote, setCcNote] = useState('');
  const [ccError, setCcError] = useState('');
  const [ccBusy, setCcBusy] = useState(false);
  const [blocked, setBlocked] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    api('/api/users/me/contact-card')
      .then((data) => {
        setCcFields(data.contactCard.fields || {});
        setCcVisibility(data.contactCard.visibility || {});
      })
      .catch(() => {});
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
        body: { username: username.trim(), bio, privacy, timezone },
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

  async function saveContactCard(e) {
    e.preventDefault();
    setCcBusy(true);
    setCcError('');
    setCcNote('');
    try {
      const data = await api('/api/users/me/contact-card', {
        method: 'PATCH',
        body: { fields: ccFields, visibility: ccVisibility },
      });
      setCcFields(data.contactCard.fields || {});
      setCcVisibility(data.contactCard.visibility || {});
      setCcNote('Contact card saved.');
    } catch (err) {
      setCcError(err.message);
    } finally {
      setCcBusy(false);
    }
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
          <label>
            My time zone (shared with people I chat with)
            <select className="text-input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              <option value="">Not shared</option>
              {TIMEZONES.map((z) => (
                <option key={z.timeZone} value={z.timeZone}>
                  {z.label}
                </option>
              ))}
            </select>
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
        <h3>Appearance</h3>
        <p className="info-sub">Default chat wallpaper and accent color — saved to your account, so they follow you across devices.</p>
        {prefs ? (
          <>
            <WallpaperPicker
              wallpaper={prefs.wallpaper}
              customWallpaperUrl={prefs.customWallpaperUrl}
              dim={prefs.wallpaperDim}
              onChange={(key, url) =>
                savePrefs({ wallpaper: key, customWallpaperUrl: url || '' }).catch((err) => setError(err.message))
              }
              onDimChange={(dim) => savePrefs({ wallpaperDim: dim }).catch(() => {})}
            />
            <h4 className="appearance-sub">Accent color</h4>
            <div className="accent-row">
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  className={`accent-swatch ${prefs.accentColor === a.value ? 'selected' : ''}`}
                  style={{ background: a.value }}
                  title={a.name}
                  onClick={() => savePrefs({ accentColor: a.value }).catch(() => {})}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="skeleton line w60" />
        )}
      </div>

      <div className="profile-card">
        <h3>Contact card</h3>
        <p className="info-sub">
          Your address-book details. You choose who sees each field: everyone, only people you
          share a conversation with (contacts), or only you. A home address can never be public.
        </p>
        {ccFields ? (
          <form onSubmit={saveContactCard} className="profile-form">
            {ccError && <p className="form-error">{ccError}</p>}
            {ccNote && <p className="ok-note">{ccNote}</p>}
            {CONTACT_FIELD_META.map((f) => (
              <div className="cc-edit-row" key={f.key}>
                <label className="cc-edit-main">
                  {f.label}
                  <input
                    type={f.input}
                    value={ccFields[f.key] || ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setCcFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </label>
                <select
                  className="text-input cc-vis"
                  aria-label={`Who can see my ${f.label}`}
                  value={ccVisibility?.[f.key] || 'nobody'}
                  onChange={(e) => setCcVisibility((prev) => ({ ...prev, [f.key]: e.target.value }))}
                >
                  {visibilityOptionsFor(f.key).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <button className="btn primary" type="submit" disabled={ccBusy}>
              {ccBusy ? 'Saving…' : 'Save contact card'}
            </button>
          </form>
        ) : (
          <div className="skeleton line w60" />
        )}
      </div>

      <BusinessEditor />

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

      <div className="profile-card">
        <h3>Security</h3>
        <p className="info-sub">
          Two-factor authentication, active sessions, sign-in history and data backup live on the
          security page.
        </p>
        <Link className="btn ghost" to="/security">Open security settings</Link>
      </div>

      <div className="profile-card danger-zone">
        <h3>Danger zone</h3>
        <p className="info-sub">Deactivating stops logins for this account. You can reactivate it later from the sign-in screen with your password.</p>
        <button className="btn danger" onClick={deactivate}>Deactivate account</button>
      </div>
    </div>
  );
}
