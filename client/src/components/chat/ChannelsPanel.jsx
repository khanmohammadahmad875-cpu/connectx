import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import Avatar from '../Avatar';

// Channel discovery (Module 14): search public channels, follow/unfollow.
// Following adds the channel to the normal chat list; only admins can post.
export default function ChannelsPanel({ onBack, onOpenConversation, onChanged }) {
  const [query, setQuery] = useState('');
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async (q) => {
    try {
      const data = await api(`/api/channels?q=${encodeURIComponent(q)}`);
      setChannels(data.channels || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query, load]);

  async function follow(channel) {
    setError('');
    try {
      await api(`/api/conversations/${channel._id}/follow`, { method: 'POST' });
      await load(query.trim());
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function unfollow(channel) {
    setError('');
    try {
      await api(`/api/conversations/${channel._id}/unfollow`, { method: 'POST' });
      await load(query.trim());
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="conv-list-wrap">
      <div className="conv-search-row">
        <button className="icon-btn" title="Back to chats" onClick={onBack}>←</button>
        <input
          className="search-input"
          placeholder="Search public channels…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="list-view-title">📣 Channels</p>
      {error && <p className="form-error">{error}</p>}
      <div className="conv-list">
        {channels.length === 0 && <p className="empty-note">No public channels found.</p>}
        {channels.map((ch) => (
          <div key={ch._id} className="conv-item static">
            <Avatar name={ch.name} src={ch.avatar} />
            <span className="conv-main">
              <span className="conv-top">
                <span className="conv-title">📣 {ch.name}</span>
              </span>
              <span className="conv-bottom">
                <span className="conv-preview">
                  {ch.followerCount} followers{ch.description ? ` · ${ch.description}` : ''}
                </span>
              </span>
            </span>
            {ch.following ? (
              <>
                <button className="btn small primary" onClick={() => onOpenConversation(ch._id)}>
                  Open
                </button>
                {ch.myRole !== 'admin' && (
                  <button className="btn small ghost" onClick={() => unfollow(ch)}>
                    Unfollow
                  </button>
                )}
              </>
            ) : (
              <button className="btn small primary" onClick={() => follow(ch)}>
                Follow
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
