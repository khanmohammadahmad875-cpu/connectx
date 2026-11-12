import { useState } from 'react';
import { formatTime } from '../../utils/format';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function Ticks({ receipt }) {
  if (receipt === 'read') return <span className="ticks read" title="Read">✓✓</span>;
  if (receipt === 'delivered') return <span className="ticks" title="Delivered">✓✓</span>;
  return <span className="ticks" title="Sent">✓</span>;
}

export default function MessageBubble({
  message,
  mine,
  isGroup,
  myId,
  receipt,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onReport,
}) {
  const [showPicker, setShowPicker] = useState(false);
  const sender = typeof message.senderId === 'object' ? message.senderId : null;

  if (message.deletedAt) {
    return (
      <div className={`msg-row ${mine ? 'mine' : ''}`}>
        <div className="bubble deleted">
          <em>This message was deleted</em>
          <span className="msg-time">{formatTime(message.createdAt)}</span>
        </div>
      </div>
    );
  }

  const reactionGroups = {};
  (message.reactions || []).forEach((r) => {
    reactionGroups[r.emoji] = (reactionGroups[r.emoji] || 0) + 1;
  });
  const myReaction = (message.reactions || []).find((r) => r.user === myId);

  return (
    <div className={`msg-row ${mine ? 'mine' : ''}`}>
      <div className={`bubble ${mine ? 'mine' : 'theirs'} ${message.pending ? 'pending' : ''}`}>
        {isGroup && !mine && sender && <div className="bubble-sender">{sender.username}</div>}

        {message.replyTo && typeof message.replyTo === 'object' && (
          <div className="reply-quote">
            <span className="reply-quote-name">
              {message.replyTo.senderId?.username || 'Message'}
            </span>
            <span className="reply-quote-text">
              {message.replyTo.deletedAt
                ? 'Deleted message'
                : message.replyTo.messageType === 'text'
                  ? message.replyTo.content
                  : message.replyTo.messageType === 'image'
                    ? 'Photo'
                    : 'File'}
            </span>
          </div>
        )}

        {message.messageType === 'image' && message.attachmentUrl && (
          <a href={message.attachmentUrl} target="_blank" rel="noreferrer">
            <img className="msg-image" src={message.attachmentUrl} alt="attachment" />
          </a>
        )}
        {message.messageType === 'file' && message.attachmentUrl && (
          <a className="msg-file" href={message.attachmentUrl} target="_blank" rel="noreferrer">
            <span className="msg-file-icon">📄</span>
            <span>{message.content || 'Download file'}</span>
          </a>
        )}
        {message.content && message.messageType === 'text' && (
          <p className="bubble-text">{message.content}</p>
        )}
        {message.content && message.messageType === 'image' && (
          <p className="bubble-text">{message.content}</p>
        )}

        <div className="bubble-meta">
          {message.editedAt && <span className="edited">edited</span>}
          <span className="msg-time">{formatTime(message.createdAt)}</span>
          {mine && !message.pending && <Ticks receipt={receipt} />}
          {message.pending && <span className="ticks">…</span>}
        </div>

        {Object.keys(reactionGroups).length > 0 && (
          <div className="reactions-row">
            {Object.entries(reactionGroups).map(([emoji, count]) => (
              <button
                key={emoji}
                className={`reaction-chip ${myReaction?.emoji === emoji ? 'mine' : ''}`}
                onClick={() => onReact(message, emoji)}
              >
                {emoji} {count > 1 ? count : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="msg-actions">
        <button title="Reply" onClick={() => onReply(message)}>↩</button>
        <button
          title="React"
          onClick={() => setShowPicker((s) => !s)}
        >
          ☺
        </button>
        {mine && (
          <>
            <button title="Edit" onClick={() => onEdit(message)}>✎</button>
            <button title="Delete" onClick={() => onDelete(message)}>🗑</button>
          </>
        )}
        {!mine && (
          <button title="Report" onClick={() => onReport(message)}>⚑</button>
        )}
        {showPicker && (
          <span className="reaction-picker">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onReact(message, emoji);
                  setShowPicker(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
