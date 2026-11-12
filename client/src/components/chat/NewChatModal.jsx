import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import Avatar from '../Avatar';

export default function NewChatModal({ onClose, onCreated }) {
  const [mode, setMode] = useState('private'); // 'private' | 'group'
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]); // group members
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
          memberIds: selected.map((u) => u._id),
        },
      });
      onCreated(data.conversation);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New conversation</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-tabs">
          <button className={mode === 'private' ? 'tab active' : 'tab'} onClick={() => setMode('private')}>
            Private chat
          </button>
          <button className={mode === 'group' ? 'tab active' : 'tab'} onClick={() => setMode('group')}>
            Group
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {mode === 'group' && (
          <input
            className="text-input"
            placeholder="Group name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        )}
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
        {mode === 'group' && (
          <button className="btn primary" onClick={createGroup} disabled={busy}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
        )}
      </div>
    </div>
  );
}
