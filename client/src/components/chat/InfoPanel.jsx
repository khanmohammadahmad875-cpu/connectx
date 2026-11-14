import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, uploadFile } from '../../services/api';
import Avatar from '../Avatar';
import WallpaperPicker from '../WallpaperPicker';
import { conversationTitle, otherParticipant } from '../../utils/format';
import { usePrefs } from '../../context/PreferencesContext';
import { effectiveWallpaper } from '../../utils/wallpapers';
import { CONTACT_FIELD_META, digitsOnly } from '../../utils/contactFields';

export default function InfoPanel({ conversation, me, onClose, onChanged, onLeft, onVisibilityChanged }) {
  const myId = me._id;
  const isGroup = conversation.type === 'group';
  const other = otherParticipant(conversation, myId);
  const [name, setName] = useState(conversation.groupName || '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const groupImageRef = useRef(null);

  const { prefs, save: savePrefs } = usePrefs();
  const [contactCard, setContactCard] = useState(null);
  const [copied, setCopied] = useState('');

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

  // Contact card of the other participant (private chats only). The API has
  // already filtered the fields to what I am allowed to see.
  useEffect(() => {
    if (isGroup || !other?._id) return;
    let cancelled = false;
    api(`/api/users/${other._id}/contact-card`)
      .then((data) => {
        if (!cancelled) setContactCard(data.contactCard);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isGroup, other?._id]);

  const wpEff = effectiveWallpaper(prefs, conversation._id);

  async function setConvWallpaper(wallpaper, customWallpaperUrl) {
    const entry = {
      conversationId: conversation._id,
      wallpaper,
      customWallpaperUrl: customWallpaperUrl || '',
      dim: wpEff.dim,
    };
    const others = (prefs?.conversationWallpapers || []).filter(
      (c) => c.conversationId !== conversation._id
    );
    await savePrefs({ conversationWallpapers: [...others, entry] }).catch((err) => setError(err.message));
  }

  async function setConvWallpaperDim(dim) {
    const entry = {
      conversationId: conversation._id,
      wallpaper: wpEff.wallpaper,
      customWallpaperUrl: wpEff.customWallpaperUrl || '',
      dim,
    };
    const others = (prefs?.conversationWallpapers || []).filter(
      (c) => c.conversationId !== conversation._id
    );
    await savePrefs({ conversationWallpapers: [...others, entry] }).catch(() => {});
  }

  async function resetConvWallpaper() {
    const others = (prefs?.conversationWallpapers || []).filter(
      (c) => c.conversationId !== conversation._id
    );
    await savePrefs({ conversationWallpapers: others }).catch(() => {});
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(''), 1500);
    } catch (err) {
      /* clipboard unavailable */
    }
  }

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
          src={isGroup || conversation.type === 'channel' ? conversation.groupImage : other?.profilePicture}
          size={72}
        />
        {isGroup && iAmAdmin && (
          <>
            <button className="btn small ghost" onClick={() => groupImageRef.current?.click()}>
              Change group picture
            </button>
            <input
              ref={groupImageRef}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const result = await uploadFile(file);
                  if (result.messageType !== 'image') throw new Error('Please choose an image file');
                  await act(
                    () =>
                      api(`/api/conversations/${conversation._id}`, {
                        method: 'PATCH',
                        body: { groupImage: result.url },
                      }),
                    'Group picture updated'
                  );
                } catch (err) {
                  setError(err.message);
                }
              }}
            />
          </>
        )}
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
        {conversation.type === 'channel' && (
          <p className="info-sub">
            📣 Channel · {conversation.followerCount ?? (conversation.participants || []).length} followers
            {conversation.description ? ` · ${conversation.description}` : ''}
          </p>
        )}
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

      <h5 className="info-section">Archive &amp; chat lock</h5>
      <div className="info-actions stack">
        {conversation.archived ? (
          <button
            className="btn ghost"
            onClick={() =>
              act(
                () => api(`/api/conversations/${conversation._id}/unarchive`, { method: 'POST' }),
                'Chat unarchived'
              )
            }
          >
            ↩ Unarchive chat
          </button>
        ) : (
          <button
            className="btn ghost"
            onClick={() =>
              act(
                () => api(`/api/conversations/${conversation._id}/archive`, { method: 'POST' }),
                'Chat archived — find it under Archived chats'
              ).then(() => onVisibilityChanged && onVisibilityChanged())
            }
          >
            🗄 Archive chat
          </button>
        )}
        {!conversation.locked ? (
          <button
            className="btn ghost"
            onClick={async () => {
              setError('');
              try {
                await api(`/api/chat-locks/${conversation._id}/lock`, { method: 'POST' });
                if (onVisibilityChanged) onVisibilityChanged();
              } catch (err) {
                setError(
                  err.status === 400
                    ? 'Set a chat lock PIN first: open Locked chats from the chat list.'
                    : err.message
                );
              }
            }}
          >
            🔒 Lock chat with PIN
          </button>
        ) : (
          <>
            <button
              className="btn ghost"
              onClick={async () => {
                setError('');
                try {
                  await api(`/api/chat-locks/${conversation._id}`, {
                    method: 'DELETE',
                    unlock: true,
                  });
                  if (onVisibilityChanged) onVisibilityChanged();
                } catch (err) {
                  setError(err.message);
                }
              }}
            >
              🔓 Remove chat lock
            </button>
            {conversation.hidden ? (
              <button
                className="btn ghost"
                onClick={async () => {
                  try {
                    await api(`/api/chat-locks/${conversation._id}/hide`, {
                      method: 'POST',
                      body: { hidden: false },
                      unlock: true,
                    });
                    if (onVisibilityChanged) onVisibilityChanged();
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                🙉 Unhide chat
              </button>
            ) : (
              <button
                className="btn ghost"
                onClick={async () => {
                  try {
                    await api(`/api/chat-locks/${conversation._id}/hide`, {
                      method: 'POST',
                      body: { hidden: true },
                    });
                    if (onVisibilityChanged) onVisibilityChanged();
                  } catch (err) {
                    setError(
                      err.status === 400
                        ? 'Set a secret code first: open Locked chats from the chat list.'
                        : err.message
                    );
                  }
                }}
              >
                🙈 Hide chat (secret code)
              </button>
            )}
          </>
        )}
      </div>

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

      <h5 className="info-section">Wallpaper for this chat</h5>
      <WallpaperPicker
        wallpaper={wpEff.wallpaper}
        customWallpaperUrl={wpEff.customWallpaperUrl}
        dim={wpEff.dim}
        onChange={(key, url) => setConvWallpaper(key, url)}
        onDimChange={setConvWallpaperDim}
      />
      {wpEff.isCustom ? (
        <button className="btn small ghost" onClick={resetConvWallpaper}>
          Reset to my default wallpaper
        </button>
      ) : (
        <p className="info-sub">Using your default wallpaper — pick one above to override it for this chat only.</p>
      )}

      {!isGroup && contactCard && (Object.keys(contactCard.fields || {}).length > 0 || contactCard.email) && (
        <>
          <h5 className="info-section">Contact card</h5>
          <div className="cc-view">
            {CONTACT_FIELD_META.filter((f) => contactCard.fields?.[f.key]).map((f) => {
              const value = contactCard.fields[f.key];
              return (
                <div className="cc-row" key={f.key}>
                  <span className="cc-label">{f.label}</span>
                  <span className="cc-value">{value}</span>
                  <span className="cc-actions">
                    <button className="mini-btn" onClick={() => copyText(value)}>
                      {copied === value ? 'Copied' : 'Copy'}
                    </button>
                    {f.key === 'whatsappNumber' && (
                      <a
                        className="mini-btn"
                        href={`https://wa.me/${digitsOnly(value)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        WhatsApp
                      </a>
                    )}
                    {f.key === 'phone' && (
                      <a className="mini-btn" href={`tel:${value}`}>
                        Call
                      </a>
                    )}
                  </span>
                </div>
              );
            })}
            {contactCard.email && (
              <div className="cc-row">
                <span className="cc-label">Email</span>
                <span className="cc-value">{contactCard.email}</span>
                <span className="cc-actions">
                  <button className="mini-btn" onClick={() => copyText(contactCard.email)}>
                    {copied === contactCard.email ? 'Copied' : 'Copy'}
                  </button>
                  <a className="mini-btn" href={`mailto:${contactCard.email}`}>
                    Email
                  </a>
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {!isGroup && other?.business?.isBusiness && (
        <>
          <h5 className="info-section">Business</h5>
          <p className="info-sub">
            {other.business.name || other.username}
            {other.business.verified ? ' · ✔ Verified business' : ''}
          </p>
          <Link className="btn small ghost" to={`/business/${other._id}`}>
            View business page
          </Link>
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
