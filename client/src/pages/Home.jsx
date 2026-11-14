import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import Avatar from '../components/Avatar';
import TiltCard from '../components/TiltCard';
import Dock from '../components/Dock';
import WeatherScene from '../components/WeatherScene';
import { useLiveWeather } from '../hooks/useLiveWeather';
import { usePrefs } from '../context/PreferencesContext';
import WeatherWidget from '../components/WeatherWidget';
import WorldClock from '../components/WorldClock';
import NewChatModal from '../components/chat/NewChatModal';
import {
  conversationAvatar,
  conversationTitle,
  formatListTime,
} from '../utils/format';
import { localTimeZone, timeInZone } from '../utils/timezones';

// Home dashboard (v3.0 Phase A): the landing page after login. A widget grid
// over the user's real data — profile, live clock, weather, world clock,
// quick actions, recent chats and an unread/notifications summary.
export default function Home() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => new Date());
  const [conversations, setConversations] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [newChatMode, setNewChatMode] = useState(null); // null | 'private' | 'group'
  const [statusUnviewed, setStatusUnviewed] = useState(0);
  const { prefs } = usePrefs();
  const liveWeather = useLiveWeather();

  useEffect(() => {
    document.title = 'ConnectX · Home';
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api('/api/conversations')
      .then((d) => setConversations(d.conversations || []))
      .catch(() => {})
      .finally(() => setLoadingConvs(false));
    api('/api/notifications')
      .then((d) => {
        setNotifications(d.notifications || []);
        setNotifUnread(d.unreadCount || 0);
      })
      .catch(() => {});
    // Upcoming events + my open tasks (Phase D widgets, modules 31/32).
    api('/api/events?upcoming=true&limit=3')
      .then((d) => setUpcomingEvents(d.events || []))
      .catch(() => {});
    api('/api/docs/my-tasks')
      .then((d) => setMyTasks(d.tasks || []))
      .catch(() => {});
    api('/api/status/feed')
      .then((d) => setStatusUnviewed((d.groups || []).filter((g) => !g.mine && g.hasUnviewed).length))
      .catch(() => {});
  }, []);

  const unreadMessages = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const recent = conversations.slice(0, 5);
  const myZone = localTimeZone();

  function openConversation(id) {
    sessionStorage.setItem('connectx_open_conv', id);
    navigate('/');
  }

  function openStatus() {
    sessionStorage.setItem('connectx_section', 'status');
    navigate('/');
  }

  // 3D dock destinations (item 11b): cross-navigation into the chat shell is
  // handed over through sessionStorage, which the Chat page consumes once.
  function handleDockNav(key) {
    if (key === 'home') return;
    if (key === 'reels') return navigate('/reels');
    if (key === 'status') return openStatus();
    if (key === 'communities' || key === 'calls') {
      sessionStorage.setItem('connectx_listview', key);
    } else if (key === 'groups') {
      sessionStorage.setItem('connectx_filter', 'groups');
    }
    navigate('/');
  }

  const ambientScene =
    prefs?.liveWeatherBackground !== false && liveWeather ? liveWeather.scene : null;

  return (
    <div className={`dash-shell ${ambientScene ? 'scene-on' : ''}`}>
      {ambientScene && <WeatherScene scene={ambientScene} className="dash-scene" />}
      <header className="dash-header">
        <div className="brand">
          <span className="brand-mark">CX</span>
          <span className="brand-text"><span className="brand-name">ConnectX</span><span className="brand-sub">by Developer Mohammad Ahmad Khan</span></span>
        </div>
        <nav className="dash-nav">
          <Link className="btn small ghost" to="/">
            💬 Chats
          </Link>
          <Link className="btn small ghost" to="/calendar">
            📅 Calendar
          </Link>
          <Link className="btn small ghost" to="/documents">
            📁 Documents
          </Link>
          <Link className="btn small ghost" to="/weather">
            🌦️ Weather
          </Link>
          <Link className="btn small ghost" to="/profile">
            Profile
          </Link>
          <Link className="btn small ghost" to="/security">
            🔐 Security
          </Link>
        </nav>
      </header>

      <h1 className="dash-greeting">
        {now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'},{' '}
        {me.username}
      </h1>

      <div className="dash-grid">
        <TiltCard className="dash-card profile-widget">
          <div className="dash-card-head">
            <h3>My profile</h3>
            <Link className="mini-btn" to="/profile">
              Edit
            </Link>
          </div>
          <div className="profile-widget-main">
            <Avatar name={me.username} src={me.profilePicture} size={64} />
            <div>
              <div className="profile-widget-name">{me.username}</div>
              <div className="info-sub">@{me.username}</div>
              <div className="info-sub">{me.email}</div>
            </div>
          </div>
          {me.bio && <p className="profile-widget-bio">{me.bio}</p>}
        </TiltCard>

        <TiltCard className="dash-card clock-widget">
          <div className="dash-card-head">
            <h3>Local time</h3>
          </div>
          <div className="clock-big">{timeInZone(myZone, now, false)}</div>
          <div className="clock-date">
            {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <div className="info-sub">{myZone.replace(/_/g, ' ')}</div>
        </TiltCard>

        <TiltCard className="dash-card">
          <div className="dash-card-head">
            <h3>Weather</h3>
            <Link className="mini-btn" to="/weather">
              Open
            </Link>
          </div>
          <WeatherWidget />
        </TiltCard>

        <TiltCard className="dash-card">
          <div className="dash-card-head">
            <h3>World clock</h3>
          </div>
          <WorldClock editable />
        </TiltCard>

        <TiltCard className="dash-card">
          <div className="dash-card-head">
            <h3>Quick actions</h3>
          </div>
          <div className="quick-actions">
            <button className="btn primary" onClick={() => setNewChatMode('private')}>
              ✉️ New chat
            </button>
            <button className="btn primary" onClick={() => setNewChatMode('group')}>
              👥 New group
            </button>
            <button className="btn ghost" onClick={openStatus}>
              🟢 New status
            </button>
            <Link className="btn ghost" to="/weather">
              🌦️ Weather
            </Link>
          </div>
        </TiltCard>

        <TiltCard className="dash-card">
          <div className="dash-card-head">
            <h3>Reels</h3>
            <Link className="mini-btn" to="/reels">
              Watch
            </Link>
          </div>
          <p className="info-sub">
            Short videos from people on ConnectX — your feed puts the interests you picked first.
          </p>
          <Link className="btn ghost" to="/reels">
            🎬 Open Reels
          </Link>
        </TiltCard>

        <TiltCard className="dash-card">
          <div className="dash-card-head">
            <h3>Upcoming events</h3>
            <Link className="mini-btn" to="/calendar">
              Calendar
            </Link>
          </div>
          {upcomingEvents.length === 0 ? (
            <p className="empty-note">No upcoming events.</p>
          ) : (
            <div className="recent-list">
              {upcomingEvents.map((e) => (
                <div key={e._id} className="recent-item static">
                  <span className="event-emoji">📅</span>
                  <span className="conv-main">
                    <span className="conv-top">
                      <span className="conv-title">{e.title}</span>
                    </span>
                    <span className="conv-bottom">
                      <span className="conv-preview">
                        {new Date(e.startAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                        {e.location ? ` · ${e.location}` : ''}
                      </span>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </TiltCard>

        <TiltCard className="dash-card">
          <div className="dash-card-head">
            <h3>My tasks</h3>
            <Link className="mini-btn" to="/documents">
              Documents
            </Link>
          </div>
          {myTasks.length === 0 ? (
            <p className="empty-note">Nothing assigned to you. 🎉</p>
          ) : (
            <div className="recent-list">
              {myTasks.slice(0, 5).map((t) => (
                <div key={t._id} className="recent-item static">
                  <span className="event-emoji">{t.status === 'in-progress' ? '🔄' : '⬜'}</span>
                  <span className="conv-main">
                    <span className="conv-top">
                      <span className="conv-title">{t.title}</span>
                    </span>
                    <span className="conv-bottom">
                      <span className="conv-preview">
                        {typeof t.list === 'object' && t.list ? t.list.title : 'Task list'}
                        {t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString()}` : ''}
                      </span>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </TiltCard>

        <TiltCard className="dash-card">
          <div className="dash-card-head">
            <h3>Recent chats</h3>
            <Link className="mini-btn" to="/">
              All chats
            </Link>
          </div>
          {loadingConvs ? (
            <div aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div className="skeleton-row" key={i}>
                  <div className="skeleton circle" />
                  <div className="skeleton-lines">
                    <div className="skeleton line w60" />
                    <div className="skeleton line w80" />
                  </div>
                </div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="empty-note">No conversations yet — start a new chat!</p>
          ) : (
            <div className="recent-list">
              {recent.map((c) => (
                <button key={c._id} className="recent-item" onClick={() => openConversation(c._id)}>
                  <Avatar
                    name={conversationTitle(c, me._id)}
                    src={conversationAvatar(c, me._id)}
                    size={40}
                  />
                  <span className="conv-main">
                    <span className="conv-top">
                      <span className="conv-title">{conversationTitle(c, me._id)}</span>
                      <span className="conv-time">{formatListTime(c.lastMessage?.createdAt || c.updatedAt)}</span>
                    </span>
                    <span className="conv-bottom">
                      <span className="conv-preview">
                        {c.lastMessage
                          ? c.lastMessage.deletedAt
                            ? 'This message was deleted'
                            : c.lastMessage.content || c.lastMessage.messageType
                          : 'No messages yet'}
                      </span>
                      {c.unreadCount > 0 && <span className="unread-badge">{c.unreadCount}</span>}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </TiltCard>

        <TiltCard className="dash-card">
          <div className="dash-card-head">
            <h3>Activity</h3>
          </div>
          <div className="activity-stats">
            <div className="activity-stat">
              <span className="activity-num">{unreadMessages}</span>
              <span className="activity-label">Unread messages</span>
            </div>
            <div className="activity-stat">
              <span className="activity-num">{notifUnread}</span>
              <span className="activity-label">Notifications</span>
            </div>
            <div className="activity-stat">
              <span className="activity-num">{conversations.length}</span>
              <span className="activity-label">Conversations</span>
            </div>
          </div>
          <div className="recent-list">
            {notifications.slice(0, 3).map((n) => (
              <button
                key={n._id}
                className="recent-item"
                onClick={() => n.conversationId && openConversation(n.conversationId)}
              >
                <Avatar name={n.senderId?.username || '?'} src={n.senderId?.profilePicture} size={36} />
                <span className="conv-main">
                  <span className="conv-preview">
                    {n.type === 'event_reminder' || n.type === 'security' ? (
                      n.text || 'Notification'
                    ) : n.type === 'missed_call' ? (
                      <>
                        <strong>{n.senderId?.username || 'Someone'}</strong> missed call
                      </>
                    ) : (
                      <>
                        <strong>{n.senderId?.username || 'Someone'}</strong> sent a message
                        {n.messageId?.content ? `: “${n.messageId.content.slice(0, 50)}”` : ''}
                      </>
                    )}
                  </span>
                </span>
                {!n.isRead && <span className="unread-dot" />}
              </button>
            ))}
            {notifications.length === 0 && <p className="empty-note">No notifications yet.</p>}
          </div>
        </TiltCard>
      </div>

      {newChatMode && (
        <NewChatModal
          initialMode={newChatMode}
          onClose={() => setNewChatMode(null)}
          onCreated={(conv) => {
            setNewChatMode(null);
            openConversation(conv._id);
          }}
        />
      )}

      <Dock
        active="home"
        badges={{ chats: unreadMessages, status: statusUnviewed }}
        onNavigate={handleDockNav}
      />
    </div>
  );
}
