import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { connectSocket, getSocket } from '../socket/socket';
import Avatar from '../components/Avatar';
import NotificationsBell from '../components/NotificationsBell';
import ConversationList from '../components/chat/ConversationList';
import StatusPanel from '../components/status/StatusPanel';
import ChatWindow from '../components/chat/ChatWindow';
import InfoPanel from '../components/chat/InfoPanel';
import NewChatModal from '../components/chat/NewChatModal';
import LockedPanel from '../components/chat/LockedPanel';
import ChannelsPanel from '../components/chat/ChannelsPanel';
import CommunitiesPanel from '../components/chat/CommunitiesPanel';
import CallsPanel from '../components/chat/CallsPanel';
import CallUI from '../components/call/CallUI';
import Dock from '../components/Dock';
import WeatherScene from '../components/WeatherScene';
import { useLiveWeather } from '../hooks/useLiveWeather';
import { CallProvider } from '../context/CallContext';
import { getUnlockToken, hasUnlockGrant } from '../utils/lock';
import { playNotificationSound } from '../utils/format';
import { usePrefs } from '../context/PreferencesContext';
import { effectiveWallpaper } from '../utils/wallpapers';

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
  const { prefs } = usePrefs();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeDetail, setActiveDetail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [section, setSection] = useState(() => {
    const wanted = sessionStorage.getItem('connectx_section');
    if (wanted) sessionStorage.removeItem('connectx_section');
    return wanted === 'status' ? 'status' : 'chats';
  }); // 'chats' | 'status'
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newMode, setNewMode] = useState('private');
  const [showInfo, setShowInfo] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifUnread, setNotifUnread] = useState(0);
  // Sidebar list views: main | archived | locked | channels | communities | calls
  const [listView, setListView] = useState(() => {
    const wanted = sessionStorage.getItem('connectx_listview');
    if (wanted) sessionStorage.removeItem('connectx_listview');
    return ['archived', 'locked', 'channels', 'communities', 'calls'].includes(wanted)
      ? wanted
      : 'main';
  });
  // Chat-list filter chips (item 1): all | unread | groups | channels. The
  // dock's "Groups" destination is this filter set to 'groups'.
  const [listFilter, setListFilter] = useState(() => {
    const f = sessionStorage.getItem('connectx_filter');
    if (f) sessionStorage.removeItem('connectx_filter');
    return ['unread', 'groups', 'channels'].includes(f) ? f : 'all';
  });
  const [statusUnviewed, setStatusUnviewed] = useState(0);
  const liveWeather = useLiveWeather();
  const prefsRef = useRef(null);
  prefsRef.current = prefs;
  const [quickReplies, setQuickReplies] = useState([]);
  // Live-location streaming state (module 29): sessionId -> watch handles.
  const liveWatchRef = useRef({});
  const [archivedConvs, setArchivedConvs] = useState([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [lockCounts, setLockCounts] = useState({ lockedCount: 0, hiddenCount: 0 });

  const activeIdRef = useRef(null);
  activeIdRef.current = activeId;
  // True while the open conversation is a locked one (opened from the Locked
  // area): its API calls must carry the unlock grant.
  const activeLockedRef = useRef(false);
  const myId = me._id;

  const unlockOpt = useCallback(
    () => (activeLockedRef.current ? { unlock: true } : {}),
    []
  );

  const loadConversations = useCallback(async () => {
    try {
      const data = await api('/api/conversations');
      setConversations(data.conversations || []);
    } catch (err) {
      /* keep the old list on transient errors */
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  const loadArchived = useCallback(async () => {
    try {
      const data = await api('/api/conversations?view=archived');
      const list = data.conversations || [];
      setArchivedConvs(list);
      setArchivedCount(list.length);
      return list;
    } catch (err) {
      return [];
    }
  }, []);

  const loadLockCounts = useCallback(async () => {
    try {
      const data = await api('/api/chat-locks/status');
      setLockCounts({
        lockedCount: data.lockedCount || 0,
        hiddenCount: data.hiddenCount || 0,
      });
    } catch (err) {
      /* ignore */
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

  const loadDetail = useCallback(
    async (id) => {
      const data = await api(`/api/conversations/${id}`, unlockOpt());
      setActiveDetail(data.conversation);
      return data.conversation;
    },
    [unlockOpt]
  );

  const markRead = useCallback(
    async (id) => {
      try {
        await api(`/api/conversations/${id}/read`, { method: 'POST', ...unlockOpt() });
        await api('/api/notifications/read', { method: 'PATCH', body: { conversationId: id } });
      } catch (err) {
        /* ignore */
      }
      loadNotifications();
      setConversations((prev) =>
        prev.map((c) => (c._id === id ? { ...c, unreadCount: 0 } : c))
      );
    },
    [loadNotifications, unlockOpt]
  );

  const selectConversation = useCallback(
    async (id, { locked = false } = {}) => {
      const socket = getSocket();
      if (activeIdRef.current && activeIdRef.current !== id && socket) {
        socket.emit('leave_conversation', { conversationId: activeIdRef.current });
      }
      activeLockedRef.current = locked;
      setActiveId(id);
      setShowInfo(false);
      setReplyTo(null);
      setEditing(null);
      setTypingUsers({});
      if (socket) socket.emit('join_conversation', { conversationId: id });
      try {
        const [, msgs] = await Promise.all([
          loadDetail(id),
          api(`/api/messages/${id}?limit=${PAGE_SIZE}`, locked ? { unlock: true } : {}),
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
    loadArchived();
    loadLockCounts();
    api('/api/business/quick-replies')
      .then((d) => setQuickReplies(d.quickReplies || []))
      .catch(() => {});
    const openId = sessionStorage.getItem('connectx_open_conv');
    if (openId) {
      sessionStorage.removeItem('connectx_open_conv');
      selectConversation(openId);
    }
    const socket = connectSocket();
    if (!socket) return undefined;

    // Re-present the chat-lock unlock grant after every (re)connect so the
    // socket can read/send in locked conversations while the grant lasts.
    const presentUnlock = () => {
      if (hasUnlockGrant()) {
        socket.emit('unlock_chats', { token: getUnlockToken() });
      }
    };
    socket.on('connect', presentUnlock);
    presentUnlock();

    const onNewMessage = ({ message }) => {
      loadConversations();
      loadArchived();
      loadLockCounts();
      if (!message) return;
      if (message.conversationId === activeIdRef.current) {
        setMessages((prev) => mergeMessage(prev, message));
        if (senderIdOf(message) !== myId) {
          markRead(message.conversationId);
        }
      } else if (senderIdOf(message) !== myId) {
        if (prefsRef.current?.soundAlerts !== false) playNotificationSound();
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
    const onLiveLocation = ({ messageId, latitude, longitude, stoppedAt, expiresAt }) => {
      if (!messageId) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m._id !== messageId || !m.liveLocation) return m;
          return {
            ...m,
            liveLocation: {
              ...m.liveLocation,
              latitude,
              longitude,
              stoppedAt: stoppedAt || m.liveLocation.stoppedAt,
              expiresAt: expiresAt || m.liveLocation.expiresAt,
            },
          };
        })
      );
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
    socket.on('live_location_update', onLiveLocation);
    socket.on('user_online', onPresence('online'));
    socket.on('user_offline', onPresence('offline'));
    return () => {
      socket.off('connect', presentUnlock);
      socket.off('new_message', onNewMessage);
      socket.off('message_updated', onUpdated);
      socket.off('message_read', onRead);
      socket.off('message_delivered', onDelivered);
      socket.off('typing_start', onTypingStart);
      socket.off('typing_stop', onTypingStop);
      socket.off('live_location_update', onLiveLocation);
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

  // Unviewed-status count for the dock's Status badge.
  const loadStatusBadge = useCallback(async () => {
    try {
      const data = await api('/api/status/feed');
      const groups = data.groups || [];
      setStatusUnviewed(groups.filter((g) => !g.mine && g.hasUnviewed).length);
    } catch (err) {
      /* badge is best-effort */
    }
  }, []);

  useEffect(() => {
    loadStatusBadge();
    const t = setInterval(loadStatusBadge, 60000);
    return () => clearInterval(t);
  }, [loadStatusBadge]);

  async function loadOlder() {
    if (!activeId || messages.length === 0) return;
    const data = await api(
      `/api/messages/${activeId}?limit=${PAGE_SIZE}&before=${messages[0]._id}`,
      unlockOpt()
    );
    const older = data.messages || [];
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m._id));
      return [...older.filter((m) => !ids.has(m._id)), ...prev];
    });
    setHasMore(older.length === PAGE_SIZE);
  }

  async function sendMessage({ content, messageType, attachmentUrl, audioMeta, videoMeta, poll }) {
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
      audioMeta: audioMeta || undefined,
      videoMeta: videoMeta || undefined,
      poll: poll
        ? {
            question: poll.question,
            options: (poll.options || []).map((text, i) => ({
              _id: `temp-opt-${i}`,
              text,
              votes: [],
            })),
            allowMultiple: !!poll.allowMultiple,
            closed: false,
          }
        : undefined,
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
      ...(audioMeta ? { audioMeta } : {}),
      ...(videoMeta ? { videoMeta } : {}),
      ...(poll ? { poll } : {}),
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
            api('/api/messages', { method: 'POST', body: payload, ...unlockOpt() })
              .then((data) => finish(data.message))
              .catch(() => {});
          }
        });
    } else {
      try {
        const data = await api('/api/messages', { method: 'POST', body: payload, ...unlockOpt() });
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
      ...unlockOpt(),
    });
    setMessages((prev) => prev.map((m) => (m._id === data.message._id ? data.message : m)));
  }

  async function deleteMessage(message) {
    if (!window.confirm('Delete this message for everyone?')) return;
    const data = await api(`/api/messages/${message._id}`, { method: 'DELETE', ...unlockOpt() });
    setMessages((prev) => prev.map((m) => (m._id === data.message._id ? data.message : m)));
    loadConversations();
  }

  // "Delete for me": hide the message locally at once; the server records the
  // per-user hide so it never reappears in this user's history.
  async function deleteMessageForMe(message) {
    setMessages((prev) => prev.filter((m) => m._id !== message._id));
    try {
      await api(`/api/messages/${message._id}/hide`, { method: 'POST', ...unlockOpt() });
    } catch (err) {
      /* best effort — a reload would resurface it only if the call failed */
    }
    loadConversations();
  }

  async function reactTo(message, emoji) {
    const data = await api(`/api/messages/${message._id}/reactions`, {
      method: 'POST',
      body: { emoji },
      ...unlockOpt(),
    });
    setMessages((prev) => prev.map((m) => (m._id === data.message._id ? data.message : m)));
  }

  async function votePoll(message, optionIds) {
    try {
      const data = await api(`/api/messages/${message._id}/vote`, {
        method: 'POST',
        body: { optionIds },
        ...unlockOpt(),
      });
      setMessages((prev) => prev.map((m) => (m._id === data.message._id ? data.message : m)));
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function closePoll(message) {
    try {
      const data = await api(`/api/messages/${message._id}/poll/close`, {
        method: 'POST',
        ...unlockOpt(),
      });
      setMessages((prev) => prev.map((m) => (m._id === data.message._id ? data.message : m)));
    } catch (err) {
      window.alert(err.message);
    }
  }

  // --- Location (module 29) ---------------------------------------------------
  async function sendLocationMessage({ latitude, longitude, label }) {
    if (!activeId) return;
    try {
      const data = await api('/api/messages', {
        method: 'POST',
        body: {
          conversationId: activeId,
          messageType: 'location',
          location: { latitude, longitude, label },
        },
        ...unlockOpt(),
      });
      if (data.message) setMessages((prev) => mergeMessage(prev, data.message));
      loadConversations();
    } catch (err) {
      window.alert(err.message);
    }
  }

  const stopLiveWatch = useCallback((sessionId) => {
    const entry = liveWatchRef.current[sessionId];
    if (!entry) return;
    if (entry.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(entry.watchId);
    }
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    delete liveWatchRef.current[sessionId];
  }, []);

  const startLiveWatch = useCallback(
    (session) => {
      if (!navigator.geolocation || !session || !session._id) return;
      stopLiveWatch(session._id);
      const entry = { watchId: null, lastSentAt: 0, expiryTimer: null };
      entry.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const now = Date.now();
          if (now - entry.lastSentAt < 10000) return; // throttle: ≤1 update / 10s
          entry.lastSentAt = now;
          const socket = getSocket();
          if (!socket) return;
          socket
            .timeout(5000)
            .emit(
              'live_location_update',
              {
                sessionId: session._id,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              },
              (err, ack) => {
                // Stopped or expired server-side: stop streaming.
                if (err || (ack && !ack.ok)) stopLiveWatch(session._id);
              }
            );
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
      const msLeft = new Date(session.expiresAt).getTime() - Date.now();
      if (msLeft > 0) {
        entry.expiryTimer = setTimeout(() => stopLiveWatch(session._id), msLeft);
      }
      liveWatchRef.current[session._id] = entry;
    },
    [stopLiveWatch]
  );

  // Stop every live-location stream when the chat shell unmounts.
  useEffect(
    () => () => {
      Object.keys(liveWatchRef.current).forEach((id) => stopLiveWatch(id));
    },
    [stopLiveWatch]
  );

  async function startLiveLocation({ latitude, longitude, label, durationSec }) {
    if (!activeId) return;
    const data = await api('/api/live-location/start', {
      method: 'POST',
      body: { conversationId: activeId, latitude, longitude, label, durationSec },
      ...unlockOpt(),
    });
    if (data.message) setMessages((prev) => mergeMessage(prev, data.message));
    if (data.session) startLiveWatch(data.session);
    loadConversations();
  }

  async function stopLiveLocation(message) {
    const sessionId = message.liveLocation?.sessionId;
    if (!sessionId) return;
    stopLiveWatch(sessionId);
    try {
      await api(`/api/live-location/${sessionId}/stop`, { method: 'POST' });
    } catch (err) {
      /* the local patch below still reflects the user's intent */
    }
    setMessages((prev) =>
      prev.map((m) =>
        m._id === message._id && m.liveLocation
          ? { ...m, liveLocation: { ...m.liveLocation, stoppedAt: new Date().toISOString() } }
          : m
      )
    );
  }

  // Archive (Module 20): visibility-only; the conversation moves to the
  // Archived view and returns automatically on the next incoming message.
  async function archiveConversation(conv) {
    try {
      await api(`/api/conversations/${conv._id}/archive`, { method: 'POST' });
      await loadConversations();
      await loadArchived();
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function unarchiveConversation(conv) {
    try {
      await api(`/api/conversations/${conv._id}/unarchive`, { method: 'POST' });
      await loadConversations();
      await loadArchived();
    } catch (err) {
      window.alert(err.message);
    }
  }

  // Pin (item 1): per-user visibility flag like archive — pinned chats stay
  // on top of the list with a pin marker.
  async function pinConversation(conv) {
    try {
      await api(`/api/conversations/${conv._id}/pin`, { method: 'POST' });
      await loadConversations();
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function unpinConversation(conv) {
    try {
      await api(`/api/conversations/${conv._id}/unpin`, { method: 'POST' });
      await loadConversations();
    } catch (err) {
      window.alert(err.message);
    }
  }

  // Called after the open conversation's lock/archive/hide state changes:
  // close it (it may no longer be accessible) and refresh every list.
  function handleVisibilityChanged() {
    setShowInfo(false);
    setActiveId(null);
    setActiveDetail(null);
    setMessages([]);
    activeLockedRef.current = false;
    loadConversations();
    loadArchived();
    loadLockCounts();
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

  // --- 3D dock / sidebar navigation (items 1 + 11b) -------------------------
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const navActive =
    section === 'status'
      ? 'status'
      : listView === 'communities'
        ? 'communities'
        : listView === 'calls'
          ? 'calls'
          : listView === 'main' && listFilter === 'groups'
            ? 'groups'
            : 'chats';
  function handleNav(key) {
    if (key === 'home') {
      navigate('/home');
    } else if (key === 'reels') {
      navigate('/reels');
    } else if (key === 'status') {
      setSection('status');
      loadStatusBadge();
    } else if (key === 'communities') {
      setSection('chats');
      setListView('communities');
    } else if (key === 'calls') {
      setSection('chats');
      setListView('calls');
    } else if (key === 'groups') {
      setSection('chats');
      setListView('main');
      setListFilter('groups');
    } else {
      setSection('chats');
      setListView('main');
      setListFilter('all');
    }
  }
  const navBadges = { chats: totalUnread, status: statusUnviewed };
  const ambientScene =
    prefs?.liveWeatherBackground !== false && liveWeather ? liveWeather.scene : null;

  return (
    <CallProvider>
    <div className={`chat-shell ${activeId ? 'has-active' : ''}`}>
      <aside className={`sidebar ${ambientScene ? 'ambient' : ''}`}>
        {ambientScene && <WeatherScene scene={ambientScene} night={liveWeather ? !liveWeather.isDay : false} className="sidebar-scene" />}
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-mark">CX</span>
            <span className="brand-text"><span className="brand-name">ConnectX</span><span className="brand-sub">by Developer Mohammad Ahmad Khan</span></span>
          </div>
          <div className="sidebar-actions">
            <button
              className="icon-btn"
              title="New chat"
              onClick={() => {
                setNewMode('private');
                setShowNew(true);
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.8-.34-4-.97L3 20l1.02-5.5A8.5 8.5 0 1 1 21 11.5Z" />
                <path d="M12 8v7M8.5 11.5h7" />
              </svg>
            </button>
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
        <Dock variant="side" active={navActive} badges={navBadges} onNavigate={handleNav} />
        {section === 'chats' ? (
          listView === 'main' ? (
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              myId={myId}
              onSelect={(id) => {
                setListView('main');
                selectConversation(id);
              }}
              loading={loadingConvs}
              mode="main"
              filter={listFilter}
              onFilterChange={setListFilter}
              onArchive={archiveConversation}
              onPin={pinConversation}
              onUnpin={unpinConversation}
              archivedCount={archivedCount}
              lockedCount={lockCounts.lockedCount + lockCounts.hiddenCount}
              onOpenArchived={async () => {
                await loadArchived();
                setListView('archived');
              }}
              onOpenLocked={() => setListView('locked')}
              onOpenChannels={() => setListView('channels')}
              onOpenCommunities={() => setListView('communities')}
              onOpenCalls={() => setListView('calls')}
              onOpenBusinesses={() => navigate('/business')}
            />
          ) : listView === 'archived' ? (
            <ConversationList
              conversations={archivedConvs}
              activeId={activeId}
              myId={myId}
              onSelect={(id) => selectConversation(id)}
              loading={false}
              mode="archived"
              onUnarchive={unarchiveConversation}
              onBack={() => setListView('main')}
            />
          ) : listView === 'locked' ? (
            <LockedPanel
              myId={myId}
              onBack={() => setListView('main')}
              onOpenConversation={(id) => selectConversation(id, { locked: true })}
              onUnlocked={() => {
                const socket = getSocket();
                if (socket && hasUnlockGrant()) {
                  socket.emit('unlock_chats', { token: getUnlockToken() });
                }
              }}
              onLockStateChanged={() => {
                loadLockCounts();
                loadConversations();
              }}
            />
          ) : listView === 'channels' ? (
            <ChannelsPanel
              onBack={() => setListView('main')}
              onOpenConversation={(id) => selectConversation(id)}
              onChanged={loadConversations}
            />
          ) : listView === 'calls' ? (
            <CallsPanel myId={myId} onBack={() => setListView('main')} />
          ) : (
            <CommunitiesPanel
              me={me}
              onBack={() => setListView('main')}
              onOpenConversation={(id) => selectConversation(id)}
              onNewCommunity={() => {
                setNewMode('community');
                setShowNew(true);
              }}
              onChanged={loadConversations}
            />
          )
        ) : (
          <StatusPanel me={me} />
        )}
        {section === 'chats' && listView === 'main' && (
          <button
            className="chat-fab"
            title="New chat"
            aria-label="New chat"
            onClick={() => {
              setNewMode('private');
              setShowNew(true);
            }}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.8-.34-4-.97L3 20l1.02-5.5A8.5 8.5 0 1 1 21 11.5Z" />
              <path d="M12 8v7M8.5 11.5h7" />
            </svg>
          </button>
        )}
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

      <Dock active={navActive} badges={navBadges} onNavigate={handleNav} />

      {activeDetail ? (
        <ChatWindow
          key={activeDetail._id}
          wallpaperPref={effectiveWallpaper(prefs, activeDetail._id)}
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
          onDeleteForMe={deleteMessageForMe}
          onReact={reactTo}
          onVote={votePoll}
          onClosePoll={closePoll}
          onSendLocation={sendLocationMessage}
          onStartLiveLocation={startLiveLocation}
          onStopLiveLocation={stopLiveLocation}
          quickReplies={quickReplies}
          onReport={reportMessage}
          onTyping={emitTyping}
          onToggleInfo={() => setShowInfo((s) => !s)}
          onChanged={() => {
            loadConversations();
            if (activeIdRef.current) loadDetail(activeIdRef.current);
          }}
          onBack={() => {
            setActiveId(null);
            setActiveDetail(null);
            activeLockedRef.current = false;
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
          onVisibilityChanged={handleVisibilityChanged}
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
          key={newMode}
          initialMode={newMode}
          onClose={() => setShowNew(false)}
          onCreated={async (conv) => {
            setShowNew(false);
            await loadConversations();
            selectConversation(conv._id);
          }}
        />
      )}

      <CallUI />
    </div>
    </CallProvider>
  );
}
