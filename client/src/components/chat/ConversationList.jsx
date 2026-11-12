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
  else text = lm.content || '';
  const senderId = typeof lm.senderId === 'object' ? lm.senderId._id : lm.senderId;
  return senderId === myId ? `You: ${text}` : text;
}

export default function ConversationList({ conversations, activeId, myId, onSelect, onNew }) {
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
        <input
          className="search-input"
          placeholder="Search chats or messages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn small primary" onClick={onNew}>
          + New
        </button>
      </div>
      <div className="conv-list">
        {filtered.length === 0 && (
          <p className="empty-note">
            {conversations.length === 0
              ? 'No conversations yet. Start a new chat!'
              : 'Nothing matches your search.'}
          </p>
        )}
        {filtered.map((conv) => {
          const title = conversationTitle(conv, myId);
          return (
            <button
              key={conv._id}
              className={`conv-item ${conv._id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(conv._id)}
            >
              <Avatar
                name={title}
                src={conversationAvatar(conv, myId)}
                online={conv.type === 'private' ? isConversationOnline(conv, myId) : undefined}
              />
              <span className="conv-main">
                <span className="conv-top">
                  <span className="conv-title">{title}</span>
                  <span className="conv-time">
                    {conv.lastMessage ? formatListTime(conv.lastMessage.createdAt) : ''}
                  </span>
                </span>
                <span className="conv-bottom">
                  <span className="conv-preview">{lastMessagePreview(conv, myId)}</span>
                  {conv.unreadCount > 0 && <span className="unread-badge">{conv.unreadCount}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
