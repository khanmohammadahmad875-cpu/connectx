import { useCallback, useEffect, useState } from 'react';
import Avatar from '../Avatar';
import { api } from '../../services/api';
import { useCall } from '../../context/CallContext';
import { formatListTime } from '../../utils/format';

function callSummary(call, myId) {
  const other = call.direction === 'outgoing' ? call.calleeId : call.callerId;
  const icon = call.type === 'video' ? '📹' : '📞';
  const arrow = call.direction === 'outgoing' ? '↗' : '↙';
  let state = '';
  if (call.status === 'missed') state = 'Missed';
  else if (call.status === 'declined') state = call.endReason === 'busy' ? 'Busy' : 'Declined';
  else if (call.status === 'completed') {
    const s = call.durationSec || 0;
    state = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  } else state = call.status;
  return { other, icon, arrow, state };
}

// Call history (module 8): the persisted call log, with call-back actions.
export default function CallsPanel({ myId, onBack }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { startCall, status } = useCall();

  const load = useCallback(async () => {
    try {
      const data = await api('/api/calls?limit=60');
      setCalls(data.calls || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="conv-list-wrap">
      <div className="conv-search-row">
        <button className="icon-btn" title="Back to chats" onClick={onBack}>←</button>
        <span className="list-view-title inline">📞 Calls</span>
        <button className="icon-btn" title="Refresh" onClick={load}>⟳</button>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="conv-list">
        {loading && <p className="empty-note">Loading calls…</p>}
        {!loading && calls.length === 0 && (
          <p className="empty-note">No calls yet. Open a chat and tap 📞 or 📹 to start one.</p>
        )}
        {calls.map((c) => {
          const { other, icon, arrow, state } = callSummary(c, myId);
          const otherId = typeof other === 'object' ? other?._id : other;
          const missed = c.status === 'missed';
          return (
            <div key={c._id} className="conv-item">
              <Avatar
                name={other?.username || '?'}
                src={other?.profilePicture || ''}
              />
              <span className="conv-main">
                <span className="conv-top">
                  <span className="conv-title">{other?.username || 'Unknown'}</span>
                  <span className="conv-time">{formatListTime(c.createdAt)}</span>
                </span>
                <span className="conv-bottom">
                  <span className={`call-state ${missed ? 'missed' : ''}`}>
                    {arrow} {icon} {state}
                  </span>
                </span>
              </span>
              <button
                className="conv-action"
                title={`Call ${other?.username || ''} back`}
                disabled={status !== 'idle' || !otherId}
                onClick={() =>
                  startCall({
                    conversationId: c.conversationId,
                    peer: { _id: otherId, username: other?.username, profilePicture: other?.profilePicture },
                    callType: c.type,
                  })
                }
              >
                {icon}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
