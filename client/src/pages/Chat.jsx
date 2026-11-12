import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { connectSocket, getSocket } from '../socket/socket';
import Avatar from '../components/Avatar';
import NotificationsBell from '../components/NotificationsBell';
import ConversationList from '../components/chat/ConversationList';
import ChatWindow from '../components/chat/ChatWindow';
import InfoPanel from '../components/chat/InfoPanel';
import NewChatModal from '../components/chat/NewChatModal';
import { playNotificationSound } from '../utils/format';

const PAGE_SIZE = 40;

function senderIdOf(m) {
  return typeof m.senderId === 'object' ? m.senderId._id : m.senderId;
}

function mergeMessage(list, incoming) {
  const idx = list.findIndex(
    (m) =>
      m._id === incoming._id ||
      (incoming.clientMessageId && m.clientMessageId === incoming.clientMessageId)
  );
  if (idx >= 0) {
    const next = [...list];
    next[idx] = incoming;
    return next;
  }
  return [...list, incoming];
}

export default function Chat() {
  const { user: me, logout } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeDetail, setActiveDetail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifUnread, setNotifUnread] = useState(0);

  const activeIdRef = useRef(null);
  activeIdRef.current = activeId;
  const myId = me._id;

  const loadConversations = useCallback(async () => {
    try {
      const data = await api('/api/conversations');
      setConversations(data.conversations || []);
    } catch (err) {
      /* keep the old list on transient errors */
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await api('/api/notifications');
      setNotifications(data.notifications || []);
      setNotifUnread(data.unreadCount || 0);
    } catch (err) {
      /* ignore */
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    const data = await api(`/api/conversations/${id}`);
    setActiveDetail(data.conversation);
    return data.conversation;
  }, []);

  const markRead = useCallback(
    async (id) => {
      try {
        await api(`/api/conversations/${id}/read`, { method: 'POST' });
        await api('/api/notifications/read', { method: 'PATCH', body: { conversationId: id } });
      } catch (err) {
        /* ignore */
      }
      loadNotifications();
      setConversations((prev) =>
        prev.map((c) => (c._id === id ? { ...c, unreadCount: 0 } : c))
      );
    },
    [loadNotifications]
  );

  const selectConversation = useCallback(
    async (id) => {
      const socket = getSocket();
      if (activeIdRef.current && activeIdRef.current !== id && socket) {
        socket.emit('leave_conversation', { conversationId: activeIdRef.current });
      }
      setActiveId(id);
      setShowInfo(false);
      setReplyTo(null);
      setEditing(null);
      setTypingUsers({});
      if (socket) socket.emit('join_conversation', { conversationId: id });
      try {
        const [, msgs] = await Promise.all([
          loadDetail(id),
          api(`/api/messages/${id}?limit=${PAGE_SIZE}`),
        ]);
        if (activeIdRef.current === id || true) {
          setMessages(msgs.messages || []);
          setHasMore((msgs.messages || []).length === PAGE_SIZE);
        }
        await markRead(id);
      } catch (err) {
        /* conversation may have been left/removed */
      }
    },
    [loadDetail, markRead]
  );

  // Initial loads + socket wiring (once).
  useEffect(() => {
    loadConversations();
    loadNotifications();
    const socket = connectSocket();
    if (!socket) return undefined;

    const onNewMessage = ({ message }) => {
      loadConversations();
      if (!message) return;
      if (message.conversationId === activeIdRef.current) {
        setMessages((prev) => mergeMessage(prev, message));
        if (senderIdOf(message) !== myId) {
          markRead(message.conversationId);
        }
      } else if (senderIdOf(message) !== myId) {
        playNotificationSound();
        loadNotifications();
      }
    };
    const onUpdated = ({ message }) => {
      if (message && message.conversationId === activeIdRef.current) {
        setMessages((prev) => prev.map((m) => (m._id === message._id ? message : m)));
      }
      loadConversations();
    };
    const onRead = ({ conversationId, userId }) => {
      if (conversationId !== activeIdRef.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          senderIdOf(m) === myId && !(m.readBy || []).includes(userId)
            ? { ...m, readBy: [...(m.readBy || []), userId] }
            : m
        )
      );
    };
    const onDelivered = ({ messageId, userId }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === messageId && !(m.deliveredTo || []).includes(userId)
            ? { ...m, deliveredTo: [...(m.deliveredTo || []), userId] }
            : m
        )
      );
    };
    const onTypingStart = ({ conversationId, userId, username }) => {
      if (conversationId !== activeIdRef.current || userId === myId) return;
      setTypingUsers((prev) => ({ ...prev, [userId]: username }));
    };
    const onTypingStop = ({ conversationId, userId }) => {
      if (conversationId !== activeIdRef.current) return;
      setTypingUsers((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    };
    const onPresence = (status) => ({ userId }) => {
      const patch = (participants) =>
        (participants || []).map((p) =>
          p._id === userId
            ? { ...p, status, lastSeen: status === 'offline' ? new Date().toISOString() : p.lastSeen }
            : p
        );
      setConversations((prev) =>
        prev.map((c) => ({ ...c, participants: patch(c.participants) }))
      );
      setActiveDetail((prev) =>
        prev ? { ...prev, participants: patch(prev.participants) } : prev
      );
    };

    socket.on('new_message', onNewMessage);
    socket.on('message_updated', onUpdated);
    socket.on('message_read', onRead);
    socket.on('message_delivered', onDelivered);
    socket.on('typing_start', onTypingStart);
    socket.on('typing_stop', onTypingStop);
    socket.on('user_online', onPresence('online'));
    socket.on('user_offline', onPresence('offline'));
    return () => {
      socket.off('new_message', onNewMessage);
      socket.off('message_updated', onUpdated);
      socket.off('message_read', onRead);
      socket.off('message_delivered', onDelivered);
      socket.off('typing_start', onTypingStart);
      socket.off('typing_stop', onTypingStop);
      socket.off('user_online');
      socket.off('user_offline');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser tab title shows the total unread count.
  useEffect(() => {
    const total = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    document.title = total > 0 ? `(${total}) ConnectX` : 'ConnectX';
  }, [conversations]);

  async function loadOlder() {
    if (!activeId || messages.length === 0) return;
    const data = await api(
      `/api/messages/${activeId}?limit=${PAGE_SIZE}&before=${messages[0]._id}`
    );
    const older = data.messages || [];
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m._id));
      return [...older.filter((m) => !ids.has(m._id)), ...prev];
    });
    setHasMore(older.length === PAGE_SIZE);
  }

  async function sendMessage({ content, messageType, attachmentUrl }) {
    if (!activeId) return;
    const clientMessageId =
      window.crypto?.randomUUID?.() || `cm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic = {
      _id: `temp-${clientMessageId}`,
      clientMessageId,
      conversationId: activeId,
      senderId: { _id: myId, username: me.username, profilePicture: me.profilePicture },
      content,
      messageType,
      attachmentUrl,
      replyTo: replyTo
        ? {
            _id: replyTo._id,
            content: replyTo.content,
            messageType: replyTo.messageType,
            deletedAt: replyTo.deletedAt,
            senderId: { username: replyTo.senderId?.username },
          }
        : null,
      reactions: [],
      readBy: [myId],
      deliveredTo: [myId],
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setReplyTo(null);

    const payload = {
      conversationId: activeId,
      content,
      messageType,
      attachmentUrl,
      replyTo: replyTo?._id || null,
      clientMessageId,
    };

    const socket = getSocket();
    const finish = (saved) => {
      if (saved) setMessages((prev) => mergeMessage(prev, saved));
      loadConversations();
    };
    if (socket && socket.connected) {
      socket
        .timeout(6000)
        .emit('send_message', payload, (err, ack) => {
          if (!err && ack && ack.ok) {
            finish(ack.message);
          } else {
            // Fall back to REST if the socket send failed.
            api('/api/messages', { method: 'POST', body: payload })
              .then((data) => finish(data.message))
              .catch(() => {});
          }
        });
    } else {
      try {
        const data = await api('/api/messages', { method: 'POST', body: payload });
        finish(data.message);
      } catch (err) {
        /* message stays in the list as pending; user can retry by resending */
      }
    }
  }

  async function editSave(message, content) {
    const data = await api(`/api/messages/${message._id}`, {
      method: 'PATCH',
      body: { content },
    });
    setMessages((prev) => prev.map((m) => (m._id === data.message._id ? data.message : m)));
  }

  async function deleteMessage(message) {
    if (!window.confirm('Delete this message for everyone?')) return;
    const data = await api(`/api/messages/${message._id}`, { method: 'DELETE' });
    setMessages((prev) => prev.map((m) => (m._id === data.message._id ? data.message : m)));
    loadConversations();
  }

  async function reactTo(message, emoji) {
    const data = await api(`/api/messages/${message._id}/reactions`, {
      method: 'POST',
      body: { emoji },
    });
    setMessages((prev) => prev.map((m) => (m._id === data.message._id ? data.message : m)));
  }

  async function reportMessage(message) {
    const reason = window.prompt('Why are you reporting this message?');
    if (!reason) return;
    try {
      await api('/api/reports', {
        method: 'POST',
        body: { reportedUser: senderIdOf(message), messageId: message._id, reason },
      });
      window.alert('Report submitted. Our admins will review it.');
    } catch (err) {
      window.alert(err.message);
    }
  }

  function emitTyping(start) {
    const socket = getSocket();
    if (socket && activeIdRef.current) {
      socket.emit(start ? 'typing_start' : 'typing_stop', {
        conversationId: activeIdRef.current,
      });
    }
  }

  const typingNames = Object.values(typingUsers);
  const typingText = typingNames.length
    ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…`
    : null;

  return (
    <div className={`chat-shell ${activeId ? 'has-active' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-mark">CX</span>
            <span className="brand-name">ConnectX</span>
          </div>
          <div className="sidebar-actions">
            <NotificationsBell
              notifications={notifications}
              unreadCount={notifUnread}
              onOpenConversation={(id) => selectConversation(id)}
              onRefresh={loadNotifications}
            />
            <button className="icon-btn" title="My profile" onClick={() => navigate('/profile')}>
              <Avatar name={me.username} src={me.profilePicture} size={32} />
            </button>
          </div>
        </div>
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          myId={myId}
          onSelect={selectConversation}
          onNew={() => setShowNew(true)}
        />
        <div className="sidebar-footer">
          <span className="me-chip">
            <Avatar name={me.username} src={me.profilePicture} online size={30} />
            <span className="me-name">{me.username}</span>
            {me.role === 'admin' && <span className="role-tag">admin</span>}
          </span>
          <span className="footer-links">
            {me.role === 'admin' && <Link to="/admin">Admin</Link>}
            <Link to="/profile">Profile</Link>
            <button
              className="link-btn"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              Log out
            </button>
          </span>
        </div>
      </aside>

      {activeDetail ? (
        <ChatWindow
          conversation={activeDetail}
          messages={messages}
          myId={myId}
          hasMore={hasMore}
          onLoadOlder={loadOlder}
          typingText={typingText}
          replyTo={replyTo}
          setReplyTo={setReplyTo}
          editing={editing}
          setEditing={setEditing}
          onSend={sendMessage}
          onEditSave={editSave}
          onDelete={deleteMessage}
          onReact={reactTo}
          onReport={reportMessage}
          onTyping={emitTyping}
          onToggleInfo={() => setShowInfo((s) => !s)}
          onBack={() => {
            setActiveId(null);
            setActiveDetail(null);
          }}
        />
      ) : (
        <section className="chat-empty">
          <div className="brand-mark big">CX</div>
          <h2>ConnectX</h2>
          <p>Select a conversation or start a new one to begin messaging.</p>
        </section>
      )}

      {showInfo && activeDetail && (
        <InfoPanel
          conversation={activeDetail}
          me={me}
          onClose={() => setShowInfo(false)}
          onChanged={async () => {
            await loadDetail(activeId);
            loadConversations();
          }}
          onLeft={() => {
            setShowInfo(false);
            setActiveId(null);
            setActiveDetail(null);
            setMessages([]);
            loadConversations();
          }}
        />
      )}

      {showNew && (
        <NewChatModal
          onClose={() => setShowNew(false)}
          onCreated={async (conv) => {
            setShowNew(false);
            await loadConversations();
            selectConversation(conv._id);
          }}
        />
      )}
    </div>
  );
}
