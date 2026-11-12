import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import Avatar from '../Avatar';
import { conversationTitle, otherParticipant } from '../../utils/format';

export default function InfoPanel({ conversation, me, onClose, onChanged, onLeft }) {
  const myId = me._id;
  const isGroup = conversation.type === 'group';
  const other = otherParticipant(conversation, myId);
  const [name, setName] = useState(conversation.groupName || '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const iAmAdmin = conversation.myRole === 'admin';
  const blockedByMe = other
    ? (me.blockedUsers || []).some((id) => id.toString() === other._id)
    : false;

  useEffect(() => {
    if (!isGroup || query.trim().length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
        const memberIds = new Set((conversation.participants || []).map((p) => p._id));
        setResults((data.users || []).filter((u) => !memberIds.has(u._id)));
      } catch (err) {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, isGroup, conversation]);

  async function act(fn, successNote) {
    setError('');
    setNote('');
    try {
      await fn();
      if (successNote) setNote(successNote);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function reportUser(userId) {
    const reason = window.prompt('Why are you reporting this user?');
    if (!reason) return;
    await act(
      () => api('/api/reports', { method: 'POST', body: { reportedUser: userId, reason } }),
      'Report submitted. Our admins will review it.'
    );
  }

  return (
    <aside className="info-panel">
      <div className="info-header">
        <h3>Details</h3>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {note && <p className="ok-note">{note}</p>}

      <div className="info-profile">
        <Avatar
          name={conversationTitle(conversation, myId)}
          src={isGroup ? conversation.groupImage : other?.profilePicture}
          size={72}
        />
        {isGroup && iAmAdmin ? (
          <div className="rename-row">
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
            <button
              className="btn small primary"
              onClick={() =>
                act(() =>
                  api(`/api/conversations/${conversation._id}`, {
                    method: 'PATCH',
                    body: { groupName: name },
                  })
                )
              }
            >
              Save
            </button>
          </div>
        ) : (
          <h4>{conversationTitle(conversation, myId)}</h4>
        )}
        {!isGroup && other && (
          <p className="info-sub">{other.status === 'online' ? 'Online now' : 'Offline'}</p>
        )}
        {isGroup && <p className="info-sub">{(conversation.participants || []).length} members · you are {conversation.myRole}</p>}
      </div>

      <label className="switch-row">
        <span>Mute notifications</span>
        <input
          type="checkbox"
          checked={!!conversation.muted}
          onChange={(e) =>
            act(() =>
              api(`/api/conversations/${conversation._id}`, {
                method: 'PATCH',
                body: { muted: e.target.checked },
              })
            )
          }
        />
      </label>

      {isGroup && (
        <>
          <h5 className="info-section">Members</h5>
          <div className="member-list">
            {(conversation.members || []).map((m) => {
              const u = m.userId;
              if (!u || typeof u !== 'object') return null;
              return (
                <div key={m._id} className="member-row">
                  <Avatar name={u.username} src={u.profilePicture} online={u.status === 'online'} size={32} />
                  <span className="member-name">
                    {u.username}
                    {u._id === myId ? ' (you)' : ''}
                  </span>
                  {m.role === 'admin' && <span className="role-tag">admin</span>}
                  {iAmAdmin && u._id !== myId && (
                    <span className="member-actions">
                      {m.role !== 'admin' && (
                        <button
                          className="mini-btn"
                          onClick={() =>
                            act(() =>
                              api(`/api/conversations/${conversation._id}/admins`, {
                                method: 'POST',
                                body: { userId: u._id },
                              })
                            )
                          }
                        >
                          Make admin
                        </button>
                      )}
                      <button
                        className="mini-btn danger"
                        onClick={() =>
                          act(() =>
                            api(`/api/conversations/${conversation._id}/members/${u._id}`, {
                              method: 'DELETE',
                            })
                          )
                        }
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {iAmAdmin && (
            <>
              <h5 className="info-section">Add member</h5>
              <input
                className="text-input"
                placeholder="Search people…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="user-results">
                {results.map((u) => (
                  <button
                    key={u._id}
                    className="user-row"
                    onClick={() =>
                      act(() =>
                        api(`/api/conversations/${conversation._id}/members`, {
                          method: 'POST',
                          body: { userId: u._id },
                        })
                      )
                    }
                  >
                    <Avatar name={u.username} src={u.profilePicture} size={32} />
                    <span>{u.username}</span>
                    <span className="picked">Add</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className="info-actions">
        {!isGroup && other && (
          <>
            {blockedByMe ? (
              <button
                className="btn ghost"
                onClick={() => act(() => api(`/api/users/${other._id}/unblock`, { method: 'POST' }), 'User unblocked')}
              >
                Unblock user
              </button>
            ) : (
              <button
                className="btn ghost danger-text"
                onClick={() => act(() => api(`/api/users/${other._id}/block`, { method: 'POST' }), 'User blocked')}
              >
                Block user
              </button>
            )}
            <button className="btn ghost danger-text" onClick={() => reportUser(other._id)}>
              Report user
            </button>
          </>
        )}
        {isGroup && (
          <button
            className="btn ghost danger-text"
            onClick={async () => {
              if (!window.confirm('Leave this group? You will lose access to its messages.')) return;
              try {
                await api(`/api/conversations/${conversation._id}/leave`, { method: 'POST' });
                onLeft();
              } catch (err) {
                setError(err.message);
              }
            }}
          >
            Leave group
          </button>
        )}
      </div>
    </aside>
  );
}
