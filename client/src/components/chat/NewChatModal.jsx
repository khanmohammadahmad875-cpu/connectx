import { useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '../../services/api';
import Avatar from '../Avatar';
import ImageCropper from '../ImageCropper';

const APP_URL = 'https://connectx-production-cd3ef1ec.up.railway.app';

// Device contacts for discovery, best source first:
//   1. the native bridge a future ConnectX APK will inject
//      (window.ConnectXContacts.getContacts() → Promise of a JSON string:
//      [{ name, phones: [], emails: [] }]);
//   2. the browser Contact Picker API (navigator.contacts.select).
// Returns null when NEITHER source exists. Contacts live in component state
// only — they are never written to the server or to localStorage; the
// discover endpoint returns public profiles and stores nothing.
async function readDeviceContacts() {
  try {
    if (window.ConnectXContacts && typeof window.ConnectXContacts.getContacts === 'function') {
      const raw = await window.ConnectXContacts.getContacts();
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) {
        return parsed.map((c) => ({
          name: c.name || '',
          emails: Array.isArray(c.emails) ? c.emails : [],
          phones: Array.isArray(c.phones) ? c.phones : [],
        }));
      }
    }
  } catch {
    /* bridge failed — fall through to the next source */
  }
  try {
    if (navigator.contacts && typeof navigator.contacts.select === 'function') {
      const picked = await navigator.contacts.select(['name', 'email', 'tel'], { multiple: true });
      return (picked || []).map((c) => ({
        name: (c.name && c.name[0]) || '',
        emails: c.email || [],
        phones: c.tel || [],
      }));
    }
  } catch {
    return []; // the picker was dismissed — treat as "no contacts picked"
  }
  return null;
}

export default function NewChatModal({ onClose, onCreated, initialMode = 'private' }) {
  const [mode, setMode] = useState(initialMode); // 'private' | 'group' | 'channel' | 'community'
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]); // group members
  const [groupName, setGroupName] = useState('');
  const [groupImage, setGroupImage] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [myGroups, setMyGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [step, setStep] = useState('members'); // group flow: 'members' -> 'details'
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const imageRef = useRef(null);
  // Contacts discovery: idle | working | done | unavailable.
  const [syncState, setSyncState] = useState('idle');
  const [matchedUsers, setMatchedUsers] = useState([]);
  const [inviteContacts, setInviteContacts] = useState([]);
  const [inviteNote, setInviteNote] = useState('');

  // Community mode: pick from my existing groups to link.
  useEffect(() => {
    if (mode !== 'community') return;
    api('/api/conversations')
      .then((data) =>
        setMyGroups((data.conversations || []).filter((c) => c.type === 'group'))
      )
      .catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
        setResults(data.users || []);
      } catch (err) {
        /* search errors are non-fatal */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Sync device contacts and split them into "on ConnectX" (matched users)
  // and "not yet" (invite list). Discovery runs per contact, in chunks, so
  // every saved contact is attributed exactly; the endpoint answers with
  // public profiles only and persists nothing.
  async function syncContacts() {
    setSyncState('working');
    setInviteNote('');
    const contacts = await readDeviceContacts();
    if (contacts === null) {
      setSyncState('unavailable');
      return;
    }
    const usable = contacts.filter(
      (c) => (c.emails && c.emails.length > 0) || (c.phones && c.phones.length > 0)
    );
    const matchedById = new Map();
    const unmatched = [];
    for (let i = 0; i < usable.length; i += 20) {
      const chunk = usable.slice(i, i + 20);
      const results = await Promise.all(
        chunk.map(async (c) => {
          try {
            const data = await api('/api/users/discover', {
              method: 'POST',
              body: { emails: c.emails, phones: c.phones },
            });
            return data.users || [];
          } catch {
            return null; // a failed lookup skips the contact silently
          }
        })
      );
      chunk.forEach((c, j) => {
        const users = results[j];
        if (users === null) return;
        if (users.length) users.forEach((u) => matchedById.set(u._id, u));
        else unmatched.push(c);
      });
    }
    setMatchedUsers([...matchedById.values()]);
    setInviteContacts(unmatched);
    setSyncState('done');
  }

  async function inviteContact(contact) {
    const text = `Chat with me on ConnectX — messages, calls, status and more: ${APP_URL}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'ConnectX', text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setInviteNote(`Invite copied — send it to ${contact.name || 'your contact'}!`);
    } catch {
      setInviteNote(`Share this link: ${APP_URL}`);
    }
  }

  async function startPrivate(user) {
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/conversations', {
        method: 'POST',
        body: { type: 'private', participantId: user._id },
      });
      onCreated(data.conversation);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function toggleMember(user) {
    setSelected((prev) =>
      prev.some((u) => u._id === user._id) ? prev.filter((u) => u._id !== user._id) : [...prev, user]
    );
  }

  const [cropFile, setCropFile] = useState(null);

  async function uploadGroupImage(file) {
    setUploading(true);
    setError('');
    try {
      const result = await uploadFile(file);
      if (result.messageType !== 'image') throw new Error('Please choose an image file');
      setGroupImage(result.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function pickGroupImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Images are cropped first (item 4); anything else keeps the old path.
    // An empty type from a phone picker still counts as an image here.
    if (!file.type || file.type.startsWith('image/')) setCropFile(file);
    else uploadGroupImage(file);
  }

  async function createGroup() {
    if (!groupName.trim()) return setError('Give the group a name');
    if (selected.length === 0) return setError('Pick at least one member');
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/conversations', {
        method: 'POST',
        body: {
          type: 'group',
          groupName: groupName.trim(),
          groupImage,
          memberIds: selected.map((u) => u._id),
        },
      });
      onCreated(data.conversation);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function createChannel() {
    if (!groupName.trim()) return setError('Give the channel a name');
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/conversations', {
        method: 'POST',
        body: {
          type: 'channel',
          groupName: groupName.trim(),
          groupImage,
          description: description.trim(),
          visibility,
        },
      });
      onCreated(data.conversation);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function createCommunity() {
    if (!groupName.trim()) return setError('Give the community a name');
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/communities', {
        method: 'POST',
        body: {
          name: groupName.trim(),
          description: description.trim(),
          avatar: groupImage,
          groupIds: selectedGroups,
        },
      });
      // Open the community's announcement channel.
      onCreated({ _id: data.community.announcementChannelId });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const inGroupDetails = mode === 'group' && step === 'details';
  const inFormMode = mode === 'channel' || mode === 'community';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {mode === 'group'
              ? step === 'members'
                ? 'New group — add members'
                : 'New group — name it'
              : mode === 'channel'
                ? 'New channel'
                : mode === 'community'
                  ? 'New community'
                  : 'New conversation'}
          </h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-tabs">
          <button
            className={mode === 'private' ? 'tab active' : 'tab'}
            onClick={() => setMode('private')}
          >
            Private chat
          </button>
          <button
            className={mode === 'group' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('group');
              setStep('members');
            }}
          >
            Group
          </button>
          <button
            className={mode === 'channel' ? 'tab active' : 'tab'}
            onClick={() => setMode('channel')}
          >
            Channel
          </button>
          <button
            className={mode === 'community' ? 'tab active' : 'tab'}
            onClick={() => setMode('community')}
          >
            Community
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}

        {!inGroupDetails && !inFormMode && (
          <>
            <input
              className="text-input"
              placeholder="Search people by name or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {mode === 'group' && selected.length > 0 && (
              <div className="chip-row">
                {selected.map((u) => (
                  <button key={u._id} className="chip" onClick={() => toggleMember(u)}>
                    {u.username} ✕
                  </button>
                ))}
              </div>
            )}
            <div className="user-results">
              {results.map((u) => (
                <button
                  key={u._id}
                  className="user-row"
                  disabled={busy}
                  onClick={() => (mode === 'private' ? startPrivate(u) : toggleMember(u))}
                >
                  <Avatar name={u.username} src={u.profilePicture} online={u.status === 'online'} size={36} />
                  <span>{u.username}</span>
                  {mode === 'group' && selected.some((s) => s._id === u._id) && <span className="picked">Added</span>}
                </button>
              ))}
              {query && results.length === 0 && <p className="empty-note">No people found.</p>}
            </div>
            {mode === 'private' && (
              <div className="contacts-sync">
                <h5 className="info-section">From your phone contacts</h5>
                {syncState === 'unavailable' ? (
                  <p className="info-sub">
                    Contact sync works in the ConnectX Android app — open ConnectX there to find
                    friends from your phone contacts.
                  </p>
                ) : (
                  <>
                    <button
                      className="btn ghost"
                      onClick={syncContacts}
                      disabled={syncState === 'working'}
                    >
                      {syncState === 'working' ? 'Syncing…' : '🔄 Sync contacts'}
                    </button>
                    {inviteNote && <p className="ok-note">{inviteNote}</p>}
                    {syncState === 'done' && matchedUsers.length === 0 && inviteContacts.length === 0 && (
                      <p className="empty-note">No contacts with an email or phone number were found.</p>
                    )}
                    {matchedUsers.length > 0 && (
                      <div className="user-results">
                        {matchedUsers.map((u) => (
                          <button
                            key={u._id}
                            className="user-row"
                            disabled={busy}
                            onClick={() => startPrivate(u)}
                          >
                            <Avatar name={u.username} src={u.profilePicture} online={u.status === 'online'} size={36} />
                            <span>{u.username}</span>
                            <span className="picked">On ConnectX · Chat</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {inviteContacts.length > 0 && (
                      <>
                        <p className="info-sub">Not on ConnectX yet:</p>
                        <div className="user-results">
                          {inviteContacts.map((c, i) => (
                            <div key={i} className="user-row static-row">
                              <Avatar name={c.name || c.emails[0] || c.phones[0] || '?'} size={36} />
                              <span className="conv-main">
                                <span>{c.name || 'Unknown contact'}</span>
                                <span className="info-sub">{c.emails[0] || c.phones[0] || ''}</span>
                              </span>
                              <button className="mini-btn" onClick={() => inviteContact(c)}>
                                Invite
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
            {mode === 'group' && (
              <button
                className="btn primary"
                onClick={() => {
                  if (selected.length === 0) return setError('Pick at least one member');
                  setError('');
                  setStep('details');
                }}
                disabled={busy}
              >
                Next →
              </button>
            )}
          </>
        )}

        {inGroupDetails && (
          <>
            <div className="group-details-head">
              <button
                type="button"
                className="group-avatar-btn"
                onClick={() => imageRef.current?.click()}
                title="Add a group picture (optional)"
              >
                <Avatar name={groupName || 'Group'} src={groupImage} size={72} />
                <span className="group-avatar-hint">{uploading ? 'Uploading…' : '📷'}</span>
              </button>
              <input
                ref={imageRef}
                type="file"
                hidden
                accept="image/*"
                onChange={pickGroupImage}
              />
              <input
                className="text-input"
                placeholder="Group name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
              />
            </div>
            <p className="info-sub">
              {selected.length} member{selected.length > 1 ? 's' : ''}: {selected.map((u) => u.username).join(', ')}
            </p>
            <div className="group-details-actions">
              <button className="btn ghost" onClick={() => setStep('members')} disabled={busy}>
                ← Back
              </button>
              <button className="btn primary" onClick={createGroup} disabled={busy || uploading}>
                {busy ? 'Creating…' : 'Create group'}
              </button>
            </div>
          </>
        )}

        {inFormMode && (
          <>
            <div className="group-details-head">
              <button
                type="button"
                className="group-avatar-btn"
                onClick={() => imageRef.current?.click()}
                title="Add a picture (optional)"
              >
                <Avatar name={groupName || (mode === 'channel' ? 'Channel' : 'Community')} src={groupImage} size={72} />
                <span className="group-avatar-hint">{uploading ? 'Uploading…' : '📷'}</span>
              </button>
              <input
                ref={imageRef}
                type="file"
                hidden
                accept="image/*"
                onChange={pickGroupImage}
              />
              <input
                className="text-input"
                placeholder={mode === 'channel' ? 'Channel name' : 'Community name'}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
              />
            </div>
            <input
              className="text-input"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
            {mode === 'channel' && (
              <label className="switch-row">
                <span>Public channel (anyone can discover and follow)</span>
                <input
                  type="checkbox"
                  checked={visibility === 'public'}
                  onChange={(e) => setVisibility(e.target.checked ? 'public' : 'private')}
                />
              </label>
            )}
            {mode === 'community' && (
              <>
                <h5 className="info-section">Link your groups (optional)</h5>
                {myGroups.length === 0 && (
                  <p className="info-sub">You have no groups yet — you can link groups later.</p>
                )}
                <div className="user-results">
                  {myGroups.map((g) => {
                    const picked = selectedGroups.includes(g._id);
                    return (
                      <button
                        key={g._id}
                        className="user-row"
                        onClick={() =>
                          setSelectedGroups((prev) =>
                            picked ? prev.filter((id) => id !== g._id) : [...prev, g._id]
                          )
                        }
                      >
                        <Avatar name={g.groupName} src={g.groupImage} size={36} />
                        <span>{g.groupName}</span>
                        {picked && <span className="picked">Linked</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <button
              className="btn primary"
              onClick={mode === 'channel' ? createChannel : createCommunity}
              disabled={busy || uploading}
            >
              {busy ? 'Creating…' : mode === 'channel' ? 'Create channel' : 'Create community'}
            </button>
          </>
        )}
      </div>
      {cropFile && (
        <ImageCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onDone={(cropped) => {
            setCropFile(null);
            uploadGroupImage(cropped);
          }}
        />
      )}
    </div>
  );
}
