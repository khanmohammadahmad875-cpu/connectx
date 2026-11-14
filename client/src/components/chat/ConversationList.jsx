import { useState } from 'react';
import Avatar from '../Avatar';
import {
  conversationAvatar,
  conversationTitle,
  formatListTime,
  isConversationOnline,
} from '../../utils/format';

function lastMessagePreview(conv, myId) {
  const lm = conv.lastMessage;
  if (!lm) return 'No messages yet';
  if (lm.deletedAt) return 'This message was deleted';
  let text;
  if (lm.messageType === 'image') text = '📷 Photo';
  else if (lm.messageType === 'file') text = '📄 File';
  else if (lm.messageType === 'audio') text = '🎤 Voice message';
  else if (lm.messageType === 'poll') text = '📊 Poll';
  else if (lm.messageType === 'location') text = '📍 Location';
  else if (lm.messageType === 'live_location') text = '📍 Live location';
  else text = lm.content || '';
  const senderId = typeof lm.senderId === 'object' ? lm.senderId._id : lm.senderId;
  return senderId === myId ? `You: ${text}` : text;
}

export default function ConversationList({
  conversations,
  activeId,
  myId,
  onSelect,
  onNew,
  loading = false,
  mode = 'main', // 'main' | 'archived'
  onArchive,
  onUnarchive,
  onBack,
  archivedCount = 0,
  lockedCount = 0,
  onOpenArchived,
  onOpenLocked,
  onOpenChannels,
  onOpenCommunities,
  onOpenCalls,
  onOpenBusinesses,
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = conversations.filter((c) => {
    if (!q) return true;
    const title = conversationTitle(c, myId).toLowerCase();
    const preview = lastMessagePreview(c, myId).toLowerCase();
    return title.includes(q) || preview.includes(q);
  });

  return (
    <div className="conv-list-wrap">
      <div className="conv-search-row">
        {mode === 'archived' && (
          <button className="icon-btn" title="Back to chats" onClick={onBack}>←</button>
        )}
        <input
          className="search-input"
          placeholder={mode === 'archived' ? 'Search archived chats…' : 'Search chats or messages…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {mode === 'main' && (
          <button className="btn small primary" onClick={onNew}>
            + New
          </button>
        )}
      </div>
      {mode === 'archived' && <p className="list-view-title">🗄 Archived chats</p>}
      {mode === 'main' && (
        <div className="conv-entries">
          <button className="conv-entry" onClick={onOpenLocked}>
            <span className="conv-entry-icon">🔒</span>
            <span className="conv-entry-label">Locked chats</span>
            {lockedCount > 0 && <span className="unread-badge">{lockedCount}</span>}
          </button>
          <button className="conv-entry" onClick={onOpenArchived}>
            <span className="conv-entry-icon">🗄</span>
            <span className="conv-entry-label">Archived chats</span>
            {archivedCount > 0 && <span className="entry-count">{archivedCount}</span>}
          </button>
          <button className="conv-entry" onClick={onOpenChannels}>
            <span className="conv-entry-icon">📣</span>
            <span className="conv-entry-label">Discover channels</span>
          </button>
          <button className="conv-entry" onClick={onOpenCommunities}>
            <span className="conv-entry-icon">👥</span>
            <span className="conv-entry-label">Communities</span>
          </button>
          <button className="conv-entry" onClick={onOpenCalls}>
            <span className="conv-entry-icon">📞</span>
            <span className="conv-entry-label">Calls</span>
          </button>
          <button className="conv-entry" onClick={onOpenBusinesses}>
            <span className="conv-entry-icon">🏢</span>
            <span className="conv-entry-label">Businesses</span>
          </button>
        </div>
      )}
      <div className="conv-list">
        {loading && conversations.length === 0 && (
          <div aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div className="skeleton-row" key={i}>
                <div className="skeleton circle" />
                <div className="skeleton-lines">
                  <div className="skeleton line w60" />
                  <div className="skeleton line w80" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="empty-note">
            {conversations.length === 0
              ? mode === 'archived'
                ? 'No archived chats.'
                : 'No conversations yet. Start a new chat!'
              : 'Nothing matches your search.'}
          </p>
        )}
        {filtered.map((conv) => {
          const title = conversationTitle(conv, myId);
          return (
            <div
              key={conv._id}
              className={`conv-item ${conv._id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(conv._id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(conv._id);
              }}
            >
              <Avatar
                name={title}
                src={conversationAvatar(conv, myId)}
                online={conv.type === 'private' ? isConversationOnline(conv, myId) : undefined}
              />
              <span className="conv-main">
                <span className="conv-top">
                  <span className="conv-title">
                    {conv.type === 'channel' ? '📣 ' : ''}
                    {title}
                  </span>
                  <span className="conv-time">
                    {conv.lastMessage ? formatListTime(conv.lastMessage.createdAt) : ''}
                  </span>
                </span>
                <span className="conv-bottom">
                  <span className="conv-preview">{lastMessagePreview(conv, myId)}</span>
                  {conv.unreadCount > 0 && <span className="unread-badge">{conv.unreadCount}</span>}
                </span>
              </span>
              {mode === 'main' && onArchive && (
                <button
                  className="conv-action"
                  title="Archive chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchive(conv);
                  }}
                >
                  🗄
                </button>
              )}
              {mode === 'archived' && onUnarchive && (
                <button
                  className="conv-action"
                  title="Unarchive chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnarchive(conv);
                  }}
                >
                  ↩
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
