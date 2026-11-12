import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import Avatar from '../components/Avatar';

export default function Admin() {
  const { user: me } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, u, r] = await Promise.all([
        api('/api/admin/stats'),
        api('/api/admin/users'),
        api('/api/admin/reports'),
      ]);
      setStats(s.stats);
      setUsers(u.users || []);
      setReports(r.reports || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (me.role === 'admin') load();
  }, [me.role, load]);

  if (me.role !== 'admin') {
    return (
      <div className="page-shell">
        <header className="page-header">
          <Link to="/" className="icon-btn">←</Link>
          <h2>Admin</h2>
        </header>
        <p className="empty-note">This area is for administrators only.</p>
      </div>
    );
  }

  async function toggleSuspend(user) {
    await api(`/api/admin/users/${user._id}/suspend`, {
      method: 'PATCH',
      body: { suspend: !user.isBlocked },
    });
    load();
  }

  async function setReportStatus(report, status) {
    await api(`/api/admin/reports/${report._id}`, { method: 'PATCH', body: { status } });
    load();
  }

  return (
    <div className="page-shell wide">
      <header className="page-header">
        <Link to="/" className="icon-btn">←</Link>
        <h2>Admin dashboard</h2>
      </header>
      {error && <p className="form-error">{error}</p>}

      {stats && (
        <div className="stat-grid">
          <div className="stat-card"><strong>{stats.users}</strong><span>Users</span></div>
          <div className="stat-card"><strong>{stats.conversations}</strong><span>Conversations</span></div>
          <div className="stat-card"><strong>{stats.messages}</strong><span>Messages</span></div>
          <div className="stat-card"><strong>{stats.pendingReports}</strong><span>Pending reports</span></div>
        </div>
      )}

      <div className="profile-card">
        <h3>Users</h3>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id}>
                  <td>
                    <span className="cell-user">
                      <Avatar name={u.username} src={u.profilePicture} size={28} />
                      {u.username}
                    </span>
                  </td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>
                    {u.isDeactivated
                      ? 'Deactivated'
                      : u.isBlocked
                        ? 'Suspended'
                        : u.status === 'online'
                          ? 'Online'
                          : 'Offline'}
                  </td>
                  <td>
                    {u.role !== 'admin' && !u.isDeactivated && (
                      <button className="mini-btn danger" onClick={() => toggleSuspend(u)}>
                        {u.isBlocked ? 'Unsuspend' : 'Suspend'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="profile-card">
        <h3>Reports</h3>
        {reports.length === 0 && <p className="empty-note">No reports yet.</p>}
        {reports.map((r) => (
          <div key={r._id} className="report-row">
            <div className="report-main">
              <span>
                <strong>{r.reportedBy?.username || '?'}</strong> reported{' '}
                <strong>{r.reportedUser?.username || '?'}</strong>
              </span>
              <span className="report-reason">{r.reason}</span>
              {r.messageId?.content && (
                <span className="report-message">Message: “{r.messageId.content.slice(0, 120)}”</span>
              )}
              <span className="report-status">Status: {r.status}</span>
            </div>
            <div className="report-actions">
              {r.status !== 'reviewed' && (
                <button className="mini-btn" onClick={() => setReportStatus(r, 'reviewed')}>Mark reviewed</button>
              )}
              {r.status !== 'dismissed' && (
                <button className="mini-btn" onClick={() => setReportStatus(r, 'dismissed')}>Dismiss</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
