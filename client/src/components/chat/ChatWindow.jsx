import { useEffect, useRef, useState } from 'react';
import Avatar from '../Avatar';
import MessageBubble from './MessageBubble';
import { uploadFile } from '../../services/api';
import {
  conversationAvatar,
  conversationTitle,
  formatLastSeen,
  otherParticipant,
} from '../../utils/format';

export default function ChatWindow({
  conversation,
  messages,
  myId,
  hasMore,
  onLoadOlder,
  typingText,
  replyTo,
  setReplyTo,
  editing,
  setEditing,
  onSend,
  onEditSave,
  onDelete,
  onReact,
  onReport,
  onTyping,
  onToggleInfo,
  onBack,
}) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimer = useRef(null);
  const skipScrollRef = useRef(false);

  const title = conversationTitle(conversation, myId);
  const other = otherParticipant(conversation, myId);
  const isGroup = conversation.type === 'group';

  useEffect(() => {
    if (editing) setText(editing.content || '');
  }, [editing]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && !skipScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    skipScrollRef.current = false;
  }, [messages, conversation._id]);

  function receiptFor(message) {
    const others = (conversation.participants || [])
      .map((p) => (typeof p === 'object' ? p._id : p))
      .filter((id) => id !== myId);
    const readBy = message.readBy || [];
    const deliveredTo = message.deliveredTo || [];
    if (others.length && others.every((id) => readBy.includes(id))) return 'read';
    if (others.length && others.every((id) => deliveredTo.includes(id))) return 'delivered';
    return 'sent';
  }

  function handleTyping(value) {
    setText(value);
    onTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), 2000);
  }

  async function handleSend() {
    const content = text.trim();
    if (editing) {
      if (!content) return;
      await onEditSave(editing, content);
      setEditing(null);
      setText('');
      return;
    }
    if (!content) return;
    setText('');
    onTyping(false);
    await onSend({ content, messageType: 'text', attachmentUrl: '' });
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const result = await uploadFile(file);
      await onSend({
        content: result.messageType === 'file' ? result.originalName : '',
        messageType: result.messageType,
        attachmentUrl: result.url,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  const subtitle = isGroup
    ? `${(conversation.participants || []).length} members`
    : other
      ? other.status === 'online'
        ? 'online'
        : formatLastSeen(other.lastSeen)
      : '';

  return (
    <section className="chat-window">
      <header className="chat-header">
        <button className="icon-btn back-btn" onClick={onBack}>←</button>
        <button className="chat-header-main" onClick={onToggleInfo}>
          <Avatar
            name={title}
            src={conversationAvatar(conversation, myId)}
            online={!isGroup && other ? other.status === 'online' : undefined}
          />
          <span className="chat-header-text">
            <span className="chat-title">{title}</span>
            <span className="chat-subtitle">{typingText || subtitle}</span>
          </span>
        </button>
        <button className="icon-btn" onClick={onToggleInfo} title="Conversation details">ⓘ</button>
      </header>

      <div className="messages" ref={scrollRef}>
        {hasMore && (
          <button
            className="btn small ghost load-older"
            onClick={() => {
              skipScrollRef.current = true;
              onLoadOlder();
            }}
          >
            Load older messages
          </button>
        )}
        {messages.length === 0 && (
          <p className="empty-note center">No messages yet. Say hello!</p>
        )}
        {messages.map((m) => {
          const senderId = typeof m.senderId === 'object' ? m.senderId._id : m.senderId;
          return (
            <MessageBubble
              key={m._id}
              message={m}
              mine={senderId === myId}
              isGroup={isGroup}
              myId={myId}
              receipt={receiptFor(m)}
              onReply={setReplyTo}
              onEdit={setEditing}
              onDelete={onDelete}
              onReact={onReact}
              onReport={onReport}
            />
          );
        })}
        {typingText && <div className="typing-bubble">{typingText}</div>}
      </div>

      {error && <p className="form-error composer-error">{error}</p>}
      {uploading && <p className="uploading-note">Uploading file…</p>}

      {replyTo && !editing && (
        <div className="reply-banner">
          <span>
            Replying to <strong>{replyTo.senderId?.username || 'message'}</strong>:{' '}
            {replyTo.messageType === 'text' ? replyTo.content : replyTo.messageType === 'image' ? 'Photo' : 'File'}
          </span>
          <button className="icon-btn" onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}
      {editing && (
        <div className="reply-banner">
          <span>Editing message</span>
          <button
            className="icon-btn"
            onClick={() => {
              setEditing(null);
              setText('');
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="composer">
        <button className="icon-btn" title="Attach a file" onClick={() => fileRef.current?.click()}>
          📎
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.txt,.doc,.docx"
          onChange={handleFile}
        />
        <textarea
          rows={1}
          placeholder="Type a message…"
          value={text}
          onChange={(e) => handleTyping(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button className="btn primary send-btn" onClick={handleSend} disabled={uploading}>
          {editing ? 'Save' : 'Send'}
        </button>
      </div>
    </section>
  );
}
