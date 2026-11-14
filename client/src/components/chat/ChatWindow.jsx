import { useEffect, useRef, useState } from 'react';
import Avatar from '../Avatar';
import MessageBubble, { replyPreviewText } from './MessageBubble';
import VoiceRecorder from './VoiceRecorder';
import PollModal from './PollModal';
import LocationPicker from './LocationPicker';
import { useCall } from '../../context/CallContext';
import { api, uploadFile } from '../../services/api';
import {
  conversationAvatar,
  conversationTitle,
  formatLastSeen,
  otherParticipant,
} from '../../utils/format';
import { wallpaperLayerStyle } from '../../utils/wallpapers';
import { timeInZone } from '../../utils/timezones';
import WeatherScene from '../WeatherScene';
import { useLiveWeather } from '../../hooks/useLiveWeather';

// Phone pickers can hand back a video with an EMPTY file.type; the message
// metadata then falls back to the MIME type implied by the extension (the
// server classifies the upload itself the same way).
const VIDEO_MIME_BY_EXT = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
function pickedMime(file) {
  if (file.type) return file.type;
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return VIDEO_MIME_BY_EXT[ext] || '';
}

// Best-effort video duration (seconds) for message metadata (item 10).
function measureVideoDuration(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => resolve(0);
    v.src = url;
  });
}

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
  onDeleteForMe,
  onReact,
  onReport,
  onVote,
  onClosePoll,
  onSendLocation,
  onStartLiveLocation,
  onStopLiveLocation,
  quickReplies = [],
  onTyping,
  onToggleInfo,
  onBack,
  onChanged,
  wallpaperPref,
}) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const { startCall, status: callStatus } = useCall();
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimer = useRef(null);
  const skipScrollRef = useRef(false);

  const title = conversationTitle(conversation, myId);
  const other = otherParticipant(conversation, myId);
  const isGroup = conversation.type === 'group';
  const isChannel = conversation.type === 'channel';
  const canPost = !isChannel || conversation.myRole === 'admin';

  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    if (isGroup || !other?.timezone) return undefined;
    const t = setInterval(() => setNowTick(new Date()), 20000);
    return () => clearInterval(t);
  }, [isGroup, other?.timezone]);

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
      if (result.messageType === 'video') {
        const duration = await measureVideoDuration(result.url);
        await onSend({
          content: '',
          messageType: 'video',
          attachmentUrl: result.url,
          videoMeta: { duration, size: file.size, mime: pickedMime(file) },
        });
      } else {
        await onSend({
          content: result.messageType === 'file' ? result.originalName : '',
          messageType: result.messageType,
          attachmentUrl: result.url,
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  const theirTime =
    !isGroup && other?.timezone ? timeInZone(other.timezone, nowTick, false) : '';
  const subtitle = isChannel
    ? `Channel · ${conversation.followerCount ?? (conversation.participants || []).length} followers`
    : isGroup
      ? `${(conversation.participants || []).length} members`
      : other
        ? `${other.status === 'online' ? 'online' : formatLastSeen(other.lastSeen)}${
            theirTime ? ` · their time ${theirTime}` : ''
          }`
        : '';

  const wpLayer = wallpaperLayerStyle(wallpaperPref);
  const wpDim = wallpaperPref ? wallpaperPref.dim ?? 45 : 45;
  const isLiveWallpaper = wallpaperPref?.wallpaper === 'live-weather';
  const liveWeather = useLiveWeather();
  const showScene = isLiveWallpaper && !!liveWeather;

  return (
    <section className="chat-window">
      {wpLayer && <div className="wallpaper-layer" style={wpLayer} aria-hidden="true" />}
      {showScene && (
        <WeatherScene scene={liveWeather.scene} className="wallpaper-layer scene-layer" />
      )}
      <header className="chat-header">
        <button className="icon-btn back-btn" onClick={onBack}>←</button>
        <button className="chat-header-main" onClick={onToggleInfo}>
          <Avatar
            name={title}
            src={conversationAvatar(conversation, myId)}
            online={!isGroup && other ? other.status === 'online' : undefined}
          />
          <span className="chat-header-text">
            <span className="chat-title">
              {title}
              {other?.business?.isBusiness && other?.business?.verified && (
                <span className="verified-badge small" title="Verified business">✔</span>
              )}
            </span>
            <span className="chat-subtitle">{typingText || subtitle}</span>
          </span>
        </button>
        {!isGroup && !isChannel && other && (
          <>
            <button
              className="icon-btn"
              title="Voice call"
              disabled={callStatus !== 'idle'}
              onClick={() =>
                startCall({
                  conversationId: conversation._id,
                  peer: {
                    _id: other._id,
                    username: other.username,
                    profilePicture: other.profilePicture,
                  },
                  callType: 'voice',
                })
              }
            >
              📞
            </button>
            <button
              className="icon-btn"
              title="Video call"
              disabled={callStatus !== 'idle'}
              onClick={() =>
                startCall({
                  conversationId: conversation._id,
                  peer: {
                    _id: other._id,
                    username: other.username,
                    profilePicture: other.profilePicture,
                  },
                  callType: 'video',
                })
              }
            >
              📹
            </button>
          </>
        )}
        <button className="icon-btn" onClick={onToggleInfo} title="Conversation details">ⓘ</button>
      </header>

      <div
        className="messages"
        ref={scrollRef}
        style={
          wpLayer || showScene
            ? { backgroundColor: `color-mix(in srgb, var(--bg) ${wpDim}%, transparent)` }
            : undefined
        }
      >
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
              isGroup={isGroup || isChannel}
              myId={myId}
              receipt={receiptFor(m)}
              onReply={setReplyTo}
              onEdit={setEditing}
              onDelete={onDelete}
              onDeleteForMe={onDeleteForMe}
              onReact={onReact}
              onReport={onReport}
              onVote={onVote}
              onClosePoll={onClosePoll}
              onStopLiveLocation={onStopLiveLocation}
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
            {replyPreviewText(replyTo)}
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

      {!canPost ? (
        <div className="composer channel-readonly">
          <span className="channel-readonly-note">
            📣 Only channel admins can post here. You can read and react.
          </span>
          {conversation.myRole !== null && conversation.createdBy !== myId && (
            <button
              className="btn small ghost"
              onClick={async () => {
                try {
                  await api(`/api/conversations/${conversation._id}/unfollow`, { method: 'POST' });
                  if (onChanged) onChanged();
                  onBack();
                } catch (err) {
                  setError(err.message);
                }
              }}
            >
              Unfollow
            </button>
          )}
        </div>
      ) : recording ? (
        <VoiceRecorder onSend={onSend} onCancel={() => setRecording(false)} />
      ) : (
        <div className="composer">
          <button className="icon-btn" title="Attach a file" onClick={() => fileRef.current?.click()}>
            📎
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.pdf,.txt,.doc,.docx"
            onChange={handleFile}
          />
          {!isChannel && (
            <button className="icon-btn" title="Create a poll" onClick={() => setShowPoll(true)}>
              📊
            </button>
          )}
          <button className="icon-btn" title="Share location" onClick={() => setShowLocation(true)}>
            📍
          </button>
          {quickReplies.length > 0 && (
            <span className="quick-wrap">
              <button
                className="icon-btn"
                title="Quick replies"
                onClick={() => setShowQuick((s) => !s)}
              >
                ⚡
              </button>
              {showQuick && (
                <span className="quick-menu">
                  {quickReplies.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setText(q.text);
                        setShowQuick(false);
                      }}
                    >
                      <strong>{q.title}</strong>
                      <span>{q.text}</span>
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
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
          {!editing && (
            <button
              className="icon-btn"
              title="Record a voice message"
              onClick={() => setRecording(true)}
            >
              🎤
            </button>
          )}
          <button className="btn primary send-btn" onClick={handleSend} disabled={uploading}>
            {editing ? 'Save' : 'Send'}
          </button>
        </div>
      )}

      {showPoll && (
        <PollModal
          onClose={() => setShowPoll(false)}
          onCreate={async (poll) => {
            await onSend({ content: '', messageType: 'poll', attachmentUrl: '', poll });
          }}
        />
      )}

      {showLocation && (
        <LocationPicker
          onClose={() => setShowLocation(false)}
          onSendLocation={async (loc) => {
            await onSendLocation(loc);
          }}
          onStartLive={async (loc) => {
            await onStartLiveLocation(loc);
          }}
        />
      )}
    </section>
  );
}
