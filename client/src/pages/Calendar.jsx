import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import Avatar from '../components/Avatar';
import { TIMEZONES, localTimeZone, zoneLabel } from '../utils/timezones';

// Calendar & meetings (module 31). A hand-rolled month grid + agenda over
// /api/events. Event times are stored as UTC instants with the event's own
// IANA zone; the UI renders them in the viewer's local zone and shows the
// event's original zone whenever it differs.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toLocalInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function Calendar() {
  const { user: me } = useAuth();
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [editing, setEditing] = useState(null); // event being edited (or 'new')
  const [form, setForm] = useState(null);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState([]);

  const myZone = localTimeZone();

  const load = useCallback(async () => {
    try {
      const data = await api('/api/events?limit=200');
      setEvents(data.events || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    document.title = 'ConnectX · Calendar';
    load();
  }, [load]);

  const monthEvents = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
    return events.filter((e) => {
      const s = new Date(e.startAt);
      return s >= start && s <= end;
    });
  }, [events, cursor]);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lead = (first.getDay() + 7) % 7; // weeks start on Sunday
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const list = [];
    for (let i = 0; i < lead; i += 1) list.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) list.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [cursor]);

  const dayEvents = useMemo(
    () => events.filter((e) => sameDay(new Date(e.startAt), selectedDay)),
    [events, selectedDay]
  );

  function openNew(day) {
    const start = new Date(day);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setForm({
      title: '',
      description: '',
      startAt: toLocalInputValue(start),
      endAt: toLocalInputValue(end),
      timezone: myZone,
      location: '',
      meetingLink: '',
      reminderMinutes: 15,
      invitees: [],
    });
    setEditing('new');
    setError('');
  }

  function openEdit(event) {
    setForm({
      title: event.title,
      description: event.description || '',
      startAt: toLocalInputValue(event.startAt),
      endAt: toLocalInputValue(event.endAt),
      timezone: event.timezone || 'UTC',
      location: event.location || '',
      meetingLink: event.meetingLink || '',
      reminderMinutes: (event.reminderMinutes && event.reminderMinutes[0]) ?? 15,
      invitees: (event.attendees || []).map((a) => ({
        _id: typeof a.user === 'object' ? a.user._id : a.user,
        username: typeof a.user === 'object' ? a.user.username : '',
        status: a.status,
      })),
    });
    setEditing(event);
    setError('');
  }

  async function searchInvitees(q) {
    setInviteQuery(q);
    if (q.trim().length < 1) {
      setInviteResults([]);
      return;
    }
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      setInviteResults(data.users || []);
    } catch (err) {
      /* best-effort */
    }
  }

  async function saveEvent(e) {
    e.preventDefault();
    setError('');
    const body = {
      title: form.title,
      description: form.description,
      startAt: new Date(form.startAt).toISOString(),
      endAt: new Date(form.endAt).toISOString(),
      timezone: form.timezone,
      location: form.location,
      meetingLink: form.meetingLink,
      reminderMinutes: [Number(form.reminderMinutes)],
      inviteeIds: form.invitees.map((i) => i._id),
    };
    try {
      if (editing === 'new') {
        await api('/api/events', { method: 'POST', body });
      } else {
        await api(`/api/events/${editing._id}`, { method: 'PATCH', body });
      }
      setEditing(null);
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteEvent(event) {
    if (!window.confirm(`Delete “${event.title}”?`)) return;
    try {
      await api(`/api/events/${event._id}`, { method: 'DELETE' });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function respond(event, status) {
    try {
      await api(`/api/events/${event._id}/respond`, { method: 'POST', body: { status } });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function eventTimeLabel(event) {
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const zoneNote =
      event.timezone && event.timezone !== myZone ? ` · ${zoneLabel(event.timezone)} ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: event.timezone }).format(start)}` : '';
    return `${fmt(start)} – ${fmt(end)}${zoneNote}`;
  }

  function myStatus(event) {
    if ((typeof event.creator === 'object' ? event.creator._id : event.creator) === me._id) return 'organizer';
    const mine = (event.attendees || []).find(
      (a) => (typeof a.user === 'object' ? a.user._id : a.user) === me._id
    );
    return mine ? mine.status : null;
  }

  return (
    <div className="dash-shell">
      <header className="dash-header">
        <div className="brand">
          <span className="brand-mark">CX</span>
          <span className="brand-text"><span className="brand-name">ConnectX</span><span className="brand-sub">by Developer Mohammad Ahmad Khan</span></span>
        </div>
        <nav className="dash-nav">
          <Link className="btn small ghost" to="/home">🏠 Home</Link>
          <Link className="btn small ghost" to="/">💬 Chats</Link>
          <Link className="btn small ghost" to="/documents">📁 Documents</Link>
          <Link className="btn small ghost" to="/profile">Profile</Link>
        </nav>
      </header>

      <h1 className="dash-greeting">Calendar</h1>
      {error && <p className="form-error">{error}</p>}

      <div className="cal-toolbar">
        <button className="btn small ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹ Prev</button>
        <h2 className="cal-title">{MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}</h2>
        <button className="btn small ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>Next ›</button>
        <button className="btn small primary" onClick={() => openNew(selectedDay)}>＋ New event</button>
      </div>

      <div className="cal-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="cal-cell empty" />;
          const todays = monthEvents.filter((e) => sameDay(new Date(e.startAt), day));
          const isToday = sameDay(day, new Date());
          const isSelected = sameDay(day, selectedDay);
          return (
            <button
              key={i}
              className={`cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedDay(day)}
            >
              <span className="cal-daynum">{day.getDate()}</span>
              {todays.slice(0, 3).map((e) => (
                <span key={e._id} className="cal-chip">{e.title}</span>
              ))}
              {todays.length > 3 && <span className="cal-more">+{todays.length - 3} more</span>}
            </button>
          );
        })}
      </div>

      <div className="dash-card cal-agenda">
        <div className="dash-card-head">
          <h3>{selectedDay.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          <button className="mini-btn" onClick={() => openNew(selectedDay)}>＋ Add</button>
        </div>
        {dayEvents.length === 0 && <p className="empty-note">No events this day.</p>}
        {dayEvents.map((event) => {
          const status = myStatus(event);
          return (
            <div key={event._id} className="cal-event-row">
              <div className="cal-event-main">
                <div className="cal-event-title">{event.title}</div>
                <div className="info-sub">{eventTimeLabel(event)}</div>
                {event.location && <div className="info-sub">📍 {event.location}</div>}
                {event.meetingLink && (
                  <div className="info-sub">
                    🔗 <a href={event.meetingLink} target="_blank" rel="noreferrer">Join meeting</a>
                  </div>
                )}
                {event.description && <div className="cal-event-desc">{event.description}</div>}
                <div className="cal-attendees">
                  {(event.attendees || []).map((a) => {
                    const u = typeof a.user === 'object' ? a.user : null;
                    if (!u) return null;
                    return (
                      <span key={u._id} className={`cal-attendee ${a.status}`}>
                        <Avatar name={u.username} src={u.profilePicture} size={18} /> {u.username} · {a.status}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="cal-event-actions">
                {status === 'organizer' && (
                  <>
                    <button className="mini-btn" onClick={() => openEdit(event)}>Edit</button>
                    <button className="mini-btn danger" onClick={() => deleteEvent(event)}>Delete</button>
                  </>
                )}
                {status === 'invited' && (
                  <>
                    <button className="mini-btn" onClick={() => respond(event, 'accepted')}>Accept</button>
                    <button className="mini-btn danger" onClick={() => respond(event, 'declined')}>Decline</button>
                  </>
                )}
                {status === 'accepted' && <span className="cal-status ok">✓ Going</span>}
                {status === 'declined' && <span className="cal-status">Declined</span>}
              </div>
            </div>
          );
        })}
      </div>

      {editing && form && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={saveEvent}>
            <h3>{editing === 'new' ? 'New event' : 'Edit event'}</h3>
            {error && <p className="form-error">{error}</p>}
            <label>
              Title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
            </label>
            <label>
              Description
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} maxLength={2000} />
            </label>
            <div className="form-row">
              <label>
                Starts
                <input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} required />
              </label>
              <label>
                Ends
                <input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} required />
              </label>
            </div>
            <div className="form-row">
              <label>
                Time zone
                <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                  {TIMEZONES.map((z) => (
                    <option key={z.timeZone} value={z.timeZone}>{z.label} ({z.timeZone})</option>
                  ))}
                  {!TIMEZONES.some((z) => z.timeZone === form.timezone) && (
                    <option value={form.timezone}>{form.timezone}</option>
                  )}
                </select>
              </label>
              <label>
                Reminder
                <select value={form.reminderMinutes} onChange={(e) => setForm({ ...form, reminderMinutes: e.target.value })}>
                  <option value={0}>At start</option>
                  <option value={5}>5 minutes before</option>
                  <option value={15}>15 minutes before</option>
                  <option value={30}>30 minutes before</option>
                  <option value={60}>1 hour before</option>
                  <option value={1440}>1 day before</option>
                </select>
              </label>
            </div>
            <label>
              Location
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={300} placeholder="Room, address…" />
            </label>
            <label>
              Meeting link
              <input value={form.meetingLink} onChange={(e) => setForm({ ...form, meetingLink: e.target.value })} maxLength={500} placeholder="https://…" />
            </label>
            <label>
              Invite people (you can only invite people you share a conversation with)
              <input
                value={inviteQuery}
                onChange={(e) => searchInvitees(e.target.value)}
                placeholder="Search by name or email…"
              />
            </label>
            {inviteResults.length > 0 && (
              <div className="invite-results">
                {inviteResults.map((u) => (
                  <button
                    type="button"
                    key={u._id}
                    className="mini-btn"
                    onClick={() => {
                      if (!form.invitees.some((i) => i._id === u._id)) {
                        setForm({ ...form, invitees: [...form.invitees, { _id: u._id, username: u.username }] });
                      }
                      setInviteResults([]);
                      setInviteQuery('');
                    }}
                  >
                    ＋ {u.username}
                  </button>
                ))}
              </div>
            )}
            {form.invitees.length > 0 && (
              <div className="invite-chips">
                {form.invitees.map((inv) => (
                  <span key={inv._id} className="invite-chip">
                    {inv.username || inv._id}
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, invitees: form.invitees.filter((i) => i._id !== inv._id) })}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn primary">{editing === 'new' ? 'Create event' : 'Save changes'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
