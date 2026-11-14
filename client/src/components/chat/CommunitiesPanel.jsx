import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import Avatar from '../Avatar';

// Communities (Module 14): containers that link several groups under one
// name, with an announcement channel and a member list derived from the
// linked groups.
export default function CommunitiesPanel({ me, onBack, onOpenConversation, onNewCommunity, onChanged }) {
  const [communities, setCommunities] = useState([]);
  const [active, setActive] = useState(null);
  const [myGroups, setMyGroups] = useState([]);
  const [linkId, setLinkId] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api('/api/communities');
      setCommunities(data.communities || []);
      return data.communities || [];
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function open(community) {
    setError('');
    setNote('');
    try {
      const data = await api(`/api/communities/${community._id}`);
      setActive(data.community);
      const convs = await api('/api/conversations');
      setMyGroups((convs.conversations || []).filter((c) => c.type === 'group'));
    } catch (err) {
      setError(err.message);
    }
  }

  async function refreshActive(id) {
    const data = await api(`/api/communities/${id}`);
    setActive(data.community);
    await load();
    if (onChanged) onChanged();
  }

  async function act(fn, successNote) {
    setError('');
    setNote('');
    try {
      await fn();
      if (successNote) setNote(successNote);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!active) {
    return (
      <div className="conv-list-wrap">
        <div className="conv-search-row">
          <button className="icon-btn" title="Back to chats" onClick={onBack}>←</button>
          <span className="list-view-title inline">👥 Communities</span>
          <button className="btn small primary" onClick={onNewCommunity}>
            + New
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="conv-list">
          {communities.length === 0 && (
            <p className="empty-note">No communities yet. Create one to group your group chats.</p>
          )}
          {communities.map((c) => (
            <div key={c._id} className="conv-item" onClick={() => open(c)} role="button" tabIndex={0}>
              <Avatar name={c.name} src={c.avatar} />
              <span className="conv-main">
                <span className="conv-top">
                  <span className="conv-title">{c.name}</span>
                </span>
                <span className="conv-bottom">
                  <span className="conv-preview">
                    {c.memberCount} members · {(c.groups || []).length} groups
                  </span>
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const linkable = myGroups.filter(
    (g) => !(active.groups || []).some((linked) => linked._id === g._id)
  );

  return (
    <div className="conv-list-wrap">
      <div className="conv-search-row">
        <button
          className="icon-btn"
          title="Back to communities"
          onClick={() => {
            setActive(null);
            load();
          }}
        >
          ←
        </button>
        <span className="list-view-title inline">👥 {active.name}</span>
      </div>
      {error && <p className="form-error">{error}</p>}
      {note && <p className="ok-note">{note}</p>}
      <div className="community-detail">
        <div className="info-profile">
          <Avatar name={active.name} src={active.avatar} size={64} />
          <h4>{active.name}</h4>
          {active.description && <p className="info-sub">{active.description}</p>}
          <p className="info-sub">
            {active.memberCount} members · by {active.createdBy?.username || 'unknown'}
          </p>
        </div>

        <h5 className="info-section">Announcements</h5>
        {active.announcementChannelId ? (
          <button
            className="btn ghost wide"
            onClick={() => onOpenConversation(active.announcementChannelId)}
          >
            📣 Open announcement channel
          </button>
        ) : (
          <p className="info-sub">No announcement channel.</p>
        )}

        <h5 className="info-section">Groups in this community</h5>
        <div className="conv-list slim">
          {(active.groups || []).length === 0 && <p className="empty-note">No groups linked yet.</p>}
          {(active.groups || []).map((g) => (
            <div key={g._id} className="conv-item static">
              <Avatar name={g.name} src={g.image} />
              <span className="conv-main">
                <span className="conv-top">
                  <span className="conv-title">{g.name}</span>
                </span>
                <span className="conv-bottom">
                  <span className="conv-preview">{g.memberCount} members</span>
                </span>
              </span>
              <button className="btn small primary" onClick={() => onOpenConversation(g._id)}>
                Open
              </button>
              {active.isAdmin && (
                <button
                  className="btn small ghost danger-text"
                  onClick={() =>
                    act(async () => {
                      await api(`/api/communities/${active._id}/groups/${g._id}`, { method: 'DELETE' });
                      await refreshActive(active._id);
                    }, 'Group unlinked.')
                  }
                >
                  Unlink
                </button>
              )}
            </div>
          ))}
        </div>

        {active.isAdmin && (
          <>
            <h5 className="info-section">Link a group</h5>
            <div className="inline-form">
              <select
                className="text-input"
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
              >
                <option value="">Choose one of your groups…</option>
                {linkable.map((g) => (
                  <option key={g._id} value={g._id}>
                    {g.groupName}
                  </option>
                ))}
              </select>
              <button
                className="btn small primary"
                disabled={!linkId}
                onClick={() =>
                  act(async () => {
                    await api(`/api/communities/${active._id}/groups`, {
                      method: 'POST',
                      body: { conversationId: linkId },
                    });
                    setLinkId('');
                    await refreshActive(active._id);
                  }, 'Group linked — its members can now read announcements.')
                }
              >
                Link
              </button>
            </div>
          </>
        )}

        <h5 className="info-section">Members</h5>
        <div className="member-list">
          {(active.members || []).map((u) => (
            <div key={u._id} className="member-row">
              <Avatar name={u.username} src={u.profilePicture} online={u.status === 'online'} size={32} />
              <span className="member-name">
                {u.username}
                {u._id === me._id ? ' (you)' : ''}
              </span>
            </div>
          ))}
        </div>

        {active.createdBy?._id === me._id && (
          <button
            className="btn ghost danger-text wide"
            onClick={() => {
              if (!window.confirm('Delete this community? The announcement channel will be removed too.')) return;
              act(async () => {
                await api(`/api/communities/${active._id}`, { method: 'DELETE' });
                setActive(null);
                await load();
                if (onChanged) onChanged();
              });
            }}
          >
            Delete community
          </button>
        )}
      </div>
    </div>
  );
}
