import { useState } from 'react';
import Avatar from '../Avatar';
import { formatTime } from '../../utils/format';
import VoiceMessage from './VoiceMessage';
import PollView from './PollView';
import LocationView from './LocationView';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export function replyPreviewText(message) {
  if (!message) return '';
  if (message.deletedAt) return 'Deleted message';
  switch (message.messageType) {
    case 'image':
      return 'Photo';
    case 'video':
      return '🎥 Video';
    case 'audio':
      return '🎤 Voice message';
    case 'poll':
      return `📊 ${message.poll?.question || 'Poll'}`;
    case 'file':
      return 'File';
    case 'call':
      return message.content || '📞 Call';
    case 'location':
      return '📍 Location';
    case 'live_location':
      return '📍 Live location';
    default:
      return message.content || '';
  }
}

// Link safety (module 24): URLs render as links showing the bare domain;
// links the server flagged (URL shortener or punycode host) get a warning
// marker. Links are never blocked — the reader decides.
const URL_SPLIT = /(https?:\/\/[^\s<>"')\]]+)/g;

export function LinkifiedText({ text, linkFlags = [] }) {
  if (!text) return null;
  const byUrl = new Map((linkFlags || []).map((l) => [l.url, l]));
  const parts = text.split(URL_SPLIT);
  return (
    <>
      {parts.map((part, i) => {
        if (!/^https?:\/\//i.test(part)) return <span key={i}>{part}</span>;
        const clean = part.replace(/[.,!?;:]+$/, '');
        const trailing = part.slice(clean.length);
        const info = byUrl.get(clean) || byUrl.get(part);
        let domain = clean;
        try {
          domain = new URL(clean).hostname.replace(/^www\./, '');
        } catch (err) {
          /* keep the raw text as the label */
        }
        return (
          <span key={i}>
            <a
              className={`bubble-link ${info?.flagged ? 'flagged' : ''}`}
              href={clean}
              target="_blank"
              rel="noreferrer"
              title={info?.flagged ? `External link via ${domain} — the final destination is hidden. Open with care.` : clean}
            >
              {domain}
              {info?.flagged ? ' ⚠️' : ''}
            </a>
            {trailing}
          </span>
        );
      })}
    </>
  );
}

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
  onDeleteForMe,
  onReact,
  onReport,
  onVote,
  onClosePoll,
  onStopLiveLocation,
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);
  const [viewingImage, setViewingImage] = useState(false);
  const sender = typeof message.senderId === 'object' ? message.senderId : null;

  // Call log entries and system notices (e.g. disappearing-messages changes)
  // render as a centered system line, not a bubble.
  if ((message.messageType === 'call' || message.messageType === 'system') && !message.deletedAt) {
    return (
      <div className="msg-row system">
        <div className="system-bubble">
          <span>{message.content || '📞 Call'}</span>
          <span className="msg-time">{formatTime(message.createdAt)}</span>
        </div>
      </div>
    );
  }

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
      {isGroup && !mine && sender && (
        <span className="msg-avatar">
          <Avatar name={sender.username} src={sender.profilePicture} size={28} />
        </span>
      )}
      <div className={`bubble ${mine ? 'mine' : 'theirs'} ${message.pending ? 'pending' : ''}`}>
        {isGroup && !mine && sender && <div className="bubble-sender">{sender.username}</div>}

        {message.replyTo && typeof message.replyTo === 'object' && (
          <div className="reply-quote">
            <span className="reply-quote-name">
              {message.replyTo.senderId?.username || 'Message'}
            </span>
            <span className="reply-quote-text">{replyPreviewText(message.replyTo)}</span>
          </div>
        )}

        {message.messageType === 'image' && message.attachmentUrl && (
          <>
            <button
              type="button"
              className="msg-image-btn"
              onClick={() => setViewingImage(true)}
              aria-label="View photo full screen"
            >
              <img className="msg-image" src={message.attachmentUrl} alt="attachment" />
            </button>
            {viewingImage && (
              <div
                className="img-viewer"
                role="dialog"
                aria-modal="true"
                onClick={() => setViewingImage(false)}
              >
                <img
                  className="img-viewer-img"
                  src={message.attachmentUrl}
                  alt="attachment full view"
                />
                <button
                  type="button"
                  className="img-viewer-close"
                  onClick={() => setViewingImage(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
                <a
                  className="img-viewer-save"
                  href={message.attachmentUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  ⬇ Save
                </a>
              </div>
            )}
          </>
        )}
        {message.messageType === 'video' && message.attachmentUrl && (
          <video
            className="msg-video"
            src={message.attachmentUrl}
            controls
            playsInline
            preload="metadata"
          />
        )}
        {message.messageType === 'file' && message.attachmentUrl && (
          <a className="msg-file" href={message.attachmentUrl} target="_blank" rel="noreferrer">
            <span className="msg-file-icon">📄</span>
            <span>{message.content || 'Download file'}</span>
          </a>
        )}
        {message.messageType === 'audio' && message.attachmentUrl && (
          <VoiceMessage message={message} />
        )}
        {message.messageType === 'poll' && message.poll && (
          <PollView message={message} myId={myId} onVote={onVote} onClosePoll={onClosePoll} />
        )}
        {message.messageType === 'location' && message.location && (
          <LocationView location={message.location} />
        )}
        {message.messageType === 'live_location' && message.liveLocation && (
          <LocationView
            live={message.liveLocation}
            onStopLive={
              mine && onStopLiveLocation ? () => onStopLiveLocation(message) : null
            }
          />
        )}
        {message.content && message.messageType === 'text' && (
          <p className="bubble-text">
            <LinkifiedText text={message.content} linkFlags={message.linkFlags} />
          </p>
        )}
        {message.content && (message.messageType === 'image' || message.messageType === 'video') && (
          <p className="bubble-text">
            <LinkifiedText text={message.content} linkFlags={message.linkFlags} />
          </p>
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
        {mine && message.messageType === 'text' && (
          <button title="Edit" onClick={() => onEdit(message)}>✎</button>
        )}
        <span className="delete-menu-wrap">
          <button title="Delete" onClick={() => setShowDeleteMenu((s) => !s)}>🗑</button>
          {showDeleteMenu && (
            <span className="delete-menu">
              {mine && (
                <button
                  onClick={() => {
                    setShowDeleteMenu(false);
                    onDelete(message);
                  }}
                >
                  Delete for everyone
                </button>
              )}
              <button
                onClick={() => {
                  setShowDeleteMenu(false);
                  onDeleteForMe(message);
                }}
              >
                Delete for me
              </button>
            </span>
          )}
        </span>
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
