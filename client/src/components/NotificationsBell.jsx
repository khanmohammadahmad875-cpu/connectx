import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import { formatListTime } from '../utils/format';

export default function NotificationsBell({ notifications, unreadCount, onOpenConversation, onRefresh }) {
  const [open, setOpen] = useState(false);

  async function markAll() {
    await api('/api/notifications/read', { method: 'PATCH', body: {} });
    onRefresh();
  }

  return (
    <div className="bell-wrap">
      <button
        className="icon-btn bell-btn"
        title="Notifications"
        onClick={() => {
          setOpen((o) => !o);
          onRefresh();
        }}
      >
        🔔
        {unreadCount > 0 && <span className="bell-badge">{unreadCount}</span>}
      </button>
      {open &&
        createPortal(
          <>
            <div className="bell-backdrop" onClick={() => setOpen(false)} />
          <div className="bell-dropdown">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button className="mini-btn" onClick={markAll}>Mark all read</button>
            )}
          </div>
          <div className="bell-list">
            {notifications.length === 0 && <p className="empty-note">No notifications.</p>}
            {notifications.map((n) => (
              <button
                key={n._id}
                className={`bell-item ${n.isRead ? '' : 'unread'}`}
                onClick={() => {
                  setOpen(false);
                  if (n.conversationId) onOpenConversation(n.conversationId);
                }}
              >
                <span className="bell-text">
                  {n.type === 'event_reminder' || n.type === 'security' ? (
                    n.text || 'Notification'
                  ) : n.type === 'missed_call' ? (
                    <>
                      <strong>{n.senderId?.username || 'Someone'}</strong> missed call
                    </>
                  ) : (
                    <>
                      <strong>{n.senderId?.username || 'Someone'}</strong> sent a message
                      {n.messageId?.content ? `: “${n.messageId.content.slice(0, 60)}”` : ''}
                    </>
                  )}
                </span>
                <span className="bell-time">{formatListTime(n.createdAt)}</span>
              </button>
            ))}
            </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
