import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, setToken, uploadFile } from '../services/api';
import { disconnectSocket } from '../socket/socket';
import Avatar from '../components/Avatar';
import BusinessEditor from '../components/business/BusinessEditor';
import WallpaperPicker from '../components/WallpaperPicker';
import ImageCropper from '../components/ImageCropper';
import WeatherScene from '../components/WeatherScene';
import { useLiveWeather } from '../hooks/useLiveWeather';
import { usePrefs } from '../context/PreferencesContext';
import { ACCENTS } from '../utils/wallpapers';
import { REEL_INTERESTS } from '../utils/interests';
import { TIMEZONES } from '../utils/timezones';
import { CONTACT_FIELD_META, visibilityOptionsFor } from '../utils/contactFields';

const APP_URL = 'https://connectx-production-cd3ef1ec.up.railway.app';

// WhatsApp-style Settings (polish items 3 + 8 + 11a): a banner profile
// header, then ONE clean settings list whose every entry maps to a real
// screen or sub-view of this page. Nothing from the old Profile page was
// removed — profile editing, appearance, contact card, blocked users,
// business editor and the danger zone all live here, one tap deep.
export default function Profile() {
  const { user: me, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState('root'); // root|edit|appearance|privacy|notifications|accessibility|business|about
  const [username, setUsername] = useState(me.username || '');
  const [bio, setBio] = useState(me.bio || '');
  const [privacy, setPrivacy] = useState({
    showLastSeen: me.privacy?.showLastSeen !== false,
    showProfilePicture: me.privacy?.showProfilePicture !== false,
  });
  const [timezone, setTimezone] = useState(me.timezone || '');
  const { prefs, save: savePrefs } = usePrefs();
  const liveWeather = useLiveWeather();
  const [ccFields, setCcFields] = useState(null);
  const [ccVisibility, setCcVisibility] = useState(null);
  const [ccNote, setCcNote] = useState('');
  const [ccError, setCcError] = useState('');
  const [ccBusy, setCcBusy] = useState(false);
  const [blocked, setBlocked] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [inviteNote, setInviteNote] = useState('');
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

  async function savePrivacy() {
    setError('');
    setNote('');
    try {
      const data = await api('/api/users/me', { method: 'PATCH', body: { privacy } });
      setUser(data.user);
      setNote('Privacy settings saved.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function uploadPicture(file) {
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

  function changePicture(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Images are cropped first (item 4); anything else keeps the old path.
    // Phone pickers can return an image with an EMPTY type — the input's
    // accept already constrained the choice, so empty still means "crop it".
    if (!file.type || file.type.startsWith('image/')) setCropFile(file);
    else uploadPicture(file);
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

  async function inviteFriend() {
    setInviteNote('');
    const shareData = {
      title: 'ConnectX',
      text: 'Chat with me on ConnectX — messages, calls, status and more.',
      url: APP_URL,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(APP_URL);
      setInviteNote('Invite link copied — send it to your friend!');
    } catch (err) {
      setInviteNote(`Share this link: ${APP_URL}`);
    }
  }

  function prefToggle(key, value) {
    savePrefs({ [key]: value }).catch((err) => setError(err.message));
  }

  function toggleInterest(name) {
    const current = prefs?.reelInterests || [];
    const next = current.includes(name)
      ? current.filter((x) => x !== name)
      : [...current, name];
    setNote('');
    savePrefs({ reelInterests: next })
      .then(() => setNote('Interests saved.'))
      .catch((err) => setError(err.message));
  }

  const subHeader = (title) => (
    <header className="page-header">
      <button className="icon-btn" onClick={() => setView('root')} aria-label="Back to settings">←</button>
      <h2>{title}</h2>
    </header>
  );

  return (
    <div className="page-shell settings-shell">
      {view === 'root' && (
        <>
          <header className="page-header">
            <Link to="/" className="icon-btn">←</Link>
            <h2>Settings</h2>
          </header>

          <div className="settings-banner-wrap">
            <div className="settings-banner">
              {liveWeather && prefs?.liveWeatherBackground !== false && (
                <WeatherScene scene={liveWeather.scene} className="settings-banner-scene" />
              )}
            </div>
            <button className="settings-profile" onClick={() => setView('edit')}>
              <span className="settings-avatar">
                <Avatar name={me.username} src={me.profilePicture} size={104} />
                <span className="settings-avatar-cam" aria-hidden="true">📷</span>
              </span>
              <span className="settings-name">{me.username}</span>
              <span className="settings-username">@{me.username}</span>
              {me.bio && <span className="settings-bio">{me.bio}</span>}
            </button>
          </div>

          {error && <p className="form-error">{error}</p>}
          {note && <p className="ok-note">{note}</p>}
          {inviteNote && <p className="ok-note">{inviteNote}</p>}

          <div className="settings-list">
            <SettingsRow icon="🔗" title="Linked devices" sub="Use ConnectX on other devices" onClick={() => navigate('/security#sessions')} />
            <SettingsRow icon="🛡️" title="Account" sub="Security notifications, 2FA, sessions" onClick={() => navigate('/security#account')} />
            <SettingsRow icon="🔒" title="Privacy" sub="Blocked accounts, chat lock, disappearing messages" onClick={() => setView('privacy')} />
            <SettingsRow icon="🔔" title="Notifications" sub="Message previews, alert sounds" onClick={() => setView('notifications')} />
            <SettingsRow icon="🎨" title="Appearance" sub="Theme, wallpaper, accent color" onClick={() => setView('appearance')} />
            <SettingsRow icon="🎯" title="Interests" sub="What your Reels feed shows first" onClick={() => setView('interests')} />
            <SettingsRow icon="💾" title="Storage and data" sub="Export or import your data" onClick={() => navigate('/security#backup')} />
            <SettingsRow icon="♿" title="Accessibility" sub="Chat font size, animations" onClick={() => setView('accessibility')} />
            <SettingsRow icon="🏢" title="My Business" sub="Business profile, products, hours, quick replies" onClick={() => setView('business')} />
            <SettingsRow icon="📅" title="Calendar" sub="Events, meetings and reminders" onClick={() => navigate('/calendar')} />
            <SettingsRow icon="📁" title="Documents & tasks" sub="Shared folders, notes and task lists" onClick={() => navigate('/documents')} />
            <SettingsRow icon="🌦️" title="Weather" sub="Weather for your saved cities" onClick={() => navigate('/weather')} />
            <SettingsRow icon="🕐" title="World clock" sub="Clocks for your saved cities" onClick={() => navigate('/home')} />
            <SettingsRow icon="❓" title="Help and feedback" sub="About ConnectX, how reporting works" onClick={() => setView('about')} />
            <SettingsRow icon="✉️" title="Invite a friend" sub="Share ConnectX with a friend" onClick={inviteFriend} />
            {me.role === 'admin' && (
              <SettingsRow icon="🛠️" title="Admin panel" sub="Users, reports and stats" onClick={() => navigate('/admin')} />
            )}
          </div>

          <div className="settings-list">
            <SettingsRow
              icon="🚪"
              title="Log out"
              sub={me.email}
              danger
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            />
          </div>

          <div className="profile-card danger-zone">
            <h3>Danger zone</h3>
            <p className="info-sub">Deactivating stops logins for this account. You can reactivate it later from the sign-in screen with your password.</p>
            <button className="btn danger" onClick={deactivate}>Deactivate account</button>
          </div>
        </>
      )}

      {view === 'edit' && (
        <>
          {subHeader('Edit profile')}
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
                  accept="image/*"
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
        </>
      )}

      {view === 'appearance' && (
        <>
          {subHeader('Appearance')}
          <div className="profile-card">
            {error && <p className="form-error">{error}</p>}
            {prefs ? (
              <>
                <h4 className="appearance-sub">Theme</h4>
                <div className="seg-row" role="group" aria-label="Theme">
                  {[
                    { v: 'light', l: 'Light' },
                    { v: 'dark', l: 'Dark' },
                    { v: 'system', l: 'System' },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      className={`seg-btn ${(prefs.theme || 'light') === o.v ? 'active' : ''}`}
                      onClick={() => prefToggle('theme', o.v)}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
                <label className="switch-row">
                  <span>Live weather background</span>
                  <input
                    type="checkbox"
                    checked={prefs.liveWeatherBackground !== false}
                    onChange={(e) => prefToggle('liveWeatherBackground', e.target.checked)}
                  />
                </label>
                <h4 className="appearance-sub">Chat wallpaper</h4>
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
        </>
      )}

      {view === 'interests' && (
        <>
          {subHeader('Interests')}
          <div className="profile-card">
            {error && <p className="form-error">{error}</p>}
            {note && <p className="ok-note">{note}</p>}
            <p className="info-sub">
              Pick the topics you enjoy — reels with these interests appear first in your Reels
              feed. Changes save right away.
            </p>
            {prefs ? (
              <div className="interest-chips">
                {REEL_INTERESTS.map((name) => {
                  const on = (prefs.reelInterests || []).includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`interest-chip ${on ? 'selected' : ''}`}
                      onClick={() => toggleInterest(name)}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="skeleton line w60" />
            )}
          </div>
        </>
      )}

      {view === 'privacy' && (
        <>
          {subHeader('Privacy')}
          {error && <p className="form-error">{error}</p>}
          {note && <p className="ok-note">{note}</p>}

          <div className="profile-card">
            <h3>Who can see my info</h3>
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
            <button className="btn primary" onClick={savePrivacy}>Save privacy settings</button>
          </div>

          <div className="profile-card">
            <h3>Disappearing messages</h3>
            <p className="info-sub">Default timer for new private chats and groups you create. You can change it per chat from the chat's info panel.</p>
            {prefs && (
              <div className="seg-row" role="group" aria-label="Default disappearing messages">
                {[
                  { v: 0, l: 'Off' },
                  { v: 86400, l: '24 hours' },
                  { v: 604800, l: '7 days' },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    className={`seg-btn ${(prefs.defaultDisappearingDuration || 0) === o.v ? 'active' : ''}`}
                    onClick={() => prefToggle('defaultDisappearingDuration', o.v)}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="profile-card">
            <h3>Chat lock</h3>
            <p className="info-sub">Locked and hidden chats are protected with your PIN and secret code.</p>
            <button
              className="btn ghost"
              onClick={() => {
                sessionStorage.setItem('connectx_listview', 'locked');
                navigate('/');
              }}
            >
              Open locked chats
            </button>
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
        </>
      )}

      {view === 'notifications' && (
        <>
          {subHeader('Notifications')}
          <div className="profile-card">
            <p className="info-sub">These apply right away and are saved to your account.</p>
            {prefs ? (
              <>
                <label className="switch-row">
                  <span>Message previews in notifications</span>
                  <input
                    type="checkbox"
                    checked={prefs.notificationPreviews !== false}
                    onChange={(e) => prefToggle('notificationPreviews', e.target.checked)}
                  />
                </label>
                <label className="switch-row">
                  <span>In-app alert sounds</span>
                  <input
                    type="checkbox"
                    checked={prefs.soundAlerts !== false}
                    onChange={(e) => prefToggle('soundAlerts', e.target.checked)}
                  />
                </label>
              </>
            ) : (
              <div className="skeleton line w60" />
            )}
          </div>
        </>
      )}

      {view === 'accessibility' && (
        <>
          {subHeader('Accessibility')}
          <div className="profile-card">
            {prefs ? (
              <>
                <h4 className="appearance-sub">Chat font size</h4>
                <div className="seg-row" role="group" aria-label="Chat font size">
                  {[
                    { v: 'small', l: 'Small' },
                    { v: 'medium', l: 'Medium' },
                    { v: 'large', l: 'Large' },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      className={`seg-btn ${(prefs.fontSize || 'medium') === o.v ? 'active' : ''}`}
                      onClick={() => prefToggle('fontSize', o.v)}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
                <label className="switch-row">
                  <span>Animations</span>
                  <input
                    type="checkbox"
                    checked={prefs.animationsEnabled !== false}
                    onChange={(e) => prefToggle('animationsEnabled', e.target.checked)}
                  />
                </label>
                <p className="info-sub">Turning animations off stops the decorative motion across the app, including the live weather scenes (they become still pictures).</p>
              </>
            ) : (
              <div className="skeleton line w60" />
            )}
          </div>
        </>
      )}

      {view === 'business' && (
        <>
          {subHeader('My Business')}
          <BusinessEditor />
        </>
      )}

      {view === 'about' && (
        <>
          {subHeader('Help and feedback')}
          <div className="profile-card about-card">
            <div className="brand center">
              <span className="brand-mark big">CX</span>
            </div>
            <h3 className="about-name">ConnectX</h3>
            <p className="info-sub center-text">Version 3.0</p>
            <p className="about-made">Made by Mohammad Ahmad Khan</p>
            <h4 className="appearance-sub">Reporting</h4>
            <p className="info-sub">
              You can report any message or user: open the message's actions (or the chat's info
              panel) and choose Report, tell us why, and our admins review every report from the
              admin panel. Blocked users can no longer message you — manage them under
              Settings → Privacy.
            </p>
            <h4 className="appearance-sub">Your data</h4>
            <p className="info-sub">
              Export a copy of your data or import a previous export any time from
              Settings → Storage and data.
            </p>
          </div>
        </>
      )}

      {cropFile && (
        <ImageCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onDone={(cropped) => {
            setCropFile(null);
            uploadPicture(cropped);
          }}
        />
      )}
    </div>
  );
}

function SettingsRow({ icon, title, sub, onClick, danger = false }) {
  return (
    <button type="button" className={`settings-row ${danger ? 'danger' : ''}`} onClick={onClick}>
      <span className="settings-row-icon" aria-hidden="true">{icon}</span>
      <span className="settings-row-main">
        <span className="settings-row-title">{title}</span>
        {sub && <span className="settings-row-sub">{sub}</span>}
      </span>
      <span className="settings-row-chevron" aria-hidden="true">›</span>
    </button>
  );
}
