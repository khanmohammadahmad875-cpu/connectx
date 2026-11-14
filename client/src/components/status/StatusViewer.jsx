import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import Avatar from '../Avatar';
import { formatListTime, formatTime } from '../../utils/format';

const DURATION_MS = 5000;

export default function StatusViewer({
  groups,
  initialGroupIndex = 0,
  myId,
  onClose,
  onViewed,
  onDelete,
}) {
  const [gi, setGi] = useState(initialGroupIndex);
  const [si, setSi] = useState(() => {
    // Start at the first unviewed status of the opening group (WhatsApp style).
    const g = groups[initialGroupIndex];
    if (!g || g.mine) return 0;
    const idx = g.statuses.findIndex((s) => !s.viewedByMe);
    return idx >= 0 ? idx : 0;
  });
  const [showViewers, setShowViewers] = useState(false);
  const [cycle, setCycle] = useState(0); // restart the progress animation per status
  const viewedSentRef = useRef(new Set());

  const group = groups[gi];
  const status = group?.statuses[si];
  const mine = !!group?.mine;

  const next = useCallback(() => {
    setShowViewers(false);
    if (!group) return onClose();
    if (si < group.statuses.length - 1) {
      setSi(si + 1);
    } else if (gi < groups.length - 1) {
      const nextGroup = groups[gi + 1];
      const idx = nextGroup.mine ? 0 : nextGroup.statuses.findIndex((s) => !s.viewedByMe);
      setGi(gi + 1);
      setSi(idx >= 0 ? idx : 0);
    } else {
      onClose();
    }
  }, [gi, si, group, groups, onClose]);

  const prev = useCallback(() => {
    setShowViewers(false);
    if (si > 0) setSi(si - 1);
    else if (gi > 0) {
      setGi(gi - 1);
      setSi(groups[gi - 1].statuses.length - 1);
    }
  }, [gi, si, groups]);

  // Auto-advance timer (paused while the viewers list is open).
  useEffect(() => {
    if (!status || showViewers) return undefined;
    const t = setTimeout(next, DURATION_MS);
    return () => clearTimeout(t);
  }, [status?._id, cycle, showViewers, next]);

  // Record a view once per status.
  useEffect(() => {
    if (!status || mine) return;
    if (status.viewedByMe || viewedSentRef.current.has(status._id)) return;
    viewedSentRef.current.add(status._id);
    api(`/api/status/${status._id}/view`, { method: 'POST' })
      .then(() => onViewed && onViewed(status._id))
      .catch(() => {});
  }, [status?._id, mine, onViewed]);

  useEffect(() => {
    setCycle((c) => c + 1);
  }, [status?._id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  if (!group || !status) return null;

  return (
    <div className="status-viewer">
      <div className="status-segments">
        {group.statuses.map((s, i) => (
          <span key={s._id} className="status-seg">
            <span
              className={`status-seg-fill ${i < si ? 'done' : ''} ${i === si ? 'active' : ''}`}
              style={i === si ? { animationDuration: `${DURATION_MS}ms` } : undefined}
              key={i === si ? `${s._id}-${cycle}` : s._id}
            />
          </span>
        ))}
      </div>

      <div className="status-viewer-head">
        <Avatar name={group.user.username} src={group.user.profilePicture} size={40} />
        <span className="status-viewer-who">
          <strong>{mine ? 'My status' : group.user.username}</strong>
          <span>{formatListTime(status.createdAt)} · {formatTime(status.createdAt)}</span>
        </span>
        {mine && (
          <button
            className="icon-btn status-del"
            title="Delete this status"
            onClick={() => onDelete && onDelete(status)}
          >
            🗑
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title="Close">✕</button>
      </div>

      <div
        className="status-body"
        style={status.type === 'text' ? { background: status.backgroundColor || '#2f7bff' } : undefined}
      >
        {status.type === 'image' ? (
          <img className="status-image" src={status.mediaUrl} alt="status" />
        ) : (
          <p className="status-text-big">{status.text}</p>
        )}
      </div>

      <button className="status-nav prev" onClick={prev} aria-label="Previous">‹</button>
      <button className="status-nav next" onClick={next} aria-label="Next">›</button>

      {mine && (
        <button className="status-views-btn" onClick={() => setShowViewers((s) => !s)}>
          👁 {status.viewersCount || 0} views
        </button>
      )}

      {mine && showViewers && (
        <div className="status-viewers">
          <h4>Viewed by</h4>
          {(status.viewers || []).length === 0 && (
            <p className="empty-note">Nobody has viewed this yet.</p>
          )}
          {(status.viewers || []).map((v) => {
            const u = typeof v.user === 'object' ? v.user : null;
            if (!u) return null;
            return (
              <div key={u._id} className="member-row">
                <Avatar name={u.username} src={u.profilePicture} size={32} />
                <span className="member-name">{u.username}</span>
                <span className="bell-time">{formatTime(v.viewedAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
