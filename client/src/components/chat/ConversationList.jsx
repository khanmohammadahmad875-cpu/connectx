import { useState } from 'react';
import Avatar from '../Avatar';
import {
  conversationAvatar,
  conversationTitle,
  formatListTime,
  isConversationOnline,
} from '../../utils/format';
import { useTilt } from '../../hooks/useTilt';

function lastMessagePreview(conv, myId) {
  const lm = conv.lastMessage;
  if (!lm) return 'No messages yet';
  if (lm.deletedAt) return 'This message was deleted';
  let text;
  if (lm.messageType === 'image') text = '📷 Photo';
  else if (lm.messageType === 'video') text = '🎥 Video';
  else if (lm.messageType === 'file') text = '📄 File';
  else if (lm.messageType === 'audio') text = '🎤 Voice message';
  else if (lm.messageType === 'poll') text = '📊 Poll';
  else if (lm.messageType === 'location') text = '📍 Location';
  else if (lm.messageType === 'live_location') text = '📍 Live location';
  else text = lm.content || '';
  const senderId = typeof lm.senderId === 'object' ? lm.senderId._id : lm.senderId;
  return senderId === myId ? `You: ${text}` : text;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'groups', label: 'Groups' },
  { key: 'channels', label: 'Channels' },
];

export default function ConversationList({
  conversations,
  activeId,
  myId,
  onSelect,
  loading = false,
  mode = 'main', // 'main' | 'archived'
  onArchive,
  onUnarchive,
  onPin,
  onUnpin,
  onBack,
  archivedCount = 0,
  lockedCount = 0,
  onOpenArchived,
  onOpenLocked,
  onOpenChannels,
  onOpenCommunities,
  onOpenCalls,
  onOpenBusinesses,
  filter = 'all',
  onFilterChange,
}) {
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState(null); // conversation id with open context menu
  const q = query.trim().toLowerCase();

  const byFilter = conversations.filter((c) => {
    if (mode !== 'main') return true;
    if (filter === 'unread') return (c.unreadCount || 0) > 0;
    if (filter === 'groups') return c.type === 'group';
    if (filter === 'channels') return c.type === 'channel';
    return true;
  });
  const filtered = byFilter.filter((c) => {
    if (!q) return true;
    const title = conversationTitle(c, myId).toLowerCase();
    const preview = lastMessagePreview(c, myId).toLowerCase();
    return title.includes(q) || preview.includes(q);
  });
  // Pinned first (stable: the server already returns pinned-first; this keeps
  // it true after any client-side reordering too).
  const sorted = [...filtered].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  const emptyText = q
    ? 'Nothing matches your search.'
    : filter === 'unread'
      ? 'No unread chats.'
      : filter === 'groups'
        ? 'No group chats yet.'
        : filter === 'channels'
          ? 'No channels yet.'
          : mode === 'archived'
            ? 'No archived chats.'
            : 'No conversations yet. Start a new chat!';

  return (
    <div className="conv-list-wrap">
      <div className="conv-search-row">
        {mode === 'archived' && (
          <button className="icon-btn" title="Back to chats" onClick={onBack}>←</button>
        )}
        <input
          className="search-input pill"
          placeholder={mode === 'archived' ? 'Search archived chats…' : 'Search or start new chat'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {mode === 'archived' && <p className="list-view-title">🗄 Archived chats</p>}
      {mode === 'main' && (
        <div className="filter-chips" role="tablist" aria-label="Filter chats">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={`filter-chip ${filter === f.key ? 'active' : ''}`}
                onClick={() => onFilterChange && onFilterChange(f.key)}
              >
                {f.label}
              </button>
            ))}
        </div>
      )}
      <div className="conv-list" onClick={() => menuFor && setMenuFor(null)}>
        {mode === 'main' && (
          <div className="conv-entries">
            <button className="conv-entry archived-entry" onClick={onOpenArchived}>
              <span className="conv-entry-icon">🗄</span>
              <span className="conv-entry-label">Archived</span>
              {archivedCount > 0 && <span className="entry-count">{archivedCount}</span>}
            </button>
            <button className="conv-entry" onClick={onOpenLocked}>
              <span className="conv-entry-icon">🔒</span>
              <span className="conv-entry-label">Locked chats</span>
              {lockedCount > 0 && <span className="unread-badge" key={lockedCount}>{lockedCount}</span>}
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
        {!loading && sorted.length === 0 && <p className="empty-note">{emptyText}</p>}
        {sorted.map((conv, i) => (
          <ConvItem
            key={conv._id}
            conv={conv}
            myId={myId}
            index={i}
            title={conversationTitle(conv, myId)}
            preview={lastMessagePreview(conv, myId)}
            active={conv._id === activeId}
            mode={mode}
            onSelect={onSelect}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
            onPin={onPin}
            onUnpin={onUnpin}
            menuOpen={menuFor === conv._id}
            setMenuOpen={(open) => setMenuFor(open ? conv._id : null)}
          />
        ))}
      </div>
    </div>
  );
}

function ConvItem({
  conv,
  myId,
  index,
  title,
  preview,
  active,
  mode,
  onSelect,
  onArchive,
  onUnarchive,
  onPin,
  onUnpin,
  menuOpen,
  setMenuOpen,
}) {
  const tilt = useTilt(2.2);
  return (
    <div
      className={`conv-item tilt-el ${active ? 'active' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
      onAnimationEnd={(e) => {
        // Clear the stagger animation once played so its fill mode never
        // fights the pointer-tilt transform.
        e.currentTarget.style.animation = 'none';
      }}
      onClick={() => onSelect(conv._id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect(conv._id);
      }}
      {...tilt}
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
          <span className="conv-preview">{preview}</span>
          {conv.pinned && <span className="conv-pin" title="Pinned">📌</span>}
          {conv.unreadCount > 0 && (
            <span className="unread-badge badge-pop" key={conv.unreadCount}>{conv.unreadCount}</span>
          )}
        </span>
      </span>
      {mode === 'main' && onPin && (
        <button
          className="conv-action"
          title={conv.pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={(e) => {
            e.stopPropagation();
            (conv.pinned ? onUnpin : onPin)(conv);
          }}
        >
          {conv.pinned ? '📍' : '📌'}
        </button>
      )}
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
      {menuOpen && (
        <div className="conv-menu" onClick={(e) => e.stopPropagation()}>
          {mode === 'main' && onPin && (
            <button
              type="button"
              onClick={() => {
                (conv.pinned ? onUnpin : onPin)(conv);
                setMenuOpen(false);
              }}
            >
              {conv.pinned ? '📍 Unpin chat' : '📌 Pin chat'}
            </button>
          )}
          {mode === 'main' && onArchive && (
            <button
              type="button"
              onClick={() => {
                onArchive(conv);
                setMenuOpen(false);
              }}
            >
              🗄 Archive chat
            </button>
          )}
          {mode === 'archived' && onUnarchive && (
            <button
              type="button"
              onClick={() => {
                onUnarchive(conv);
                setMenuOpen(false);
              }}
            >
              ↩ Unarchive chat
            </button>
          )}
        </div>
      )}
    </div>
  );
}
