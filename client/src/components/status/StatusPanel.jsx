import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '../../services/api';
import Avatar from '../Avatar';
import StatusViewer from './StatusViewer';
import { formatListTime } from '../../utils/format';

const TEXT_COLORS = ['#2f7bff', '#7b2ff7', '#f72f6d', '#f79c2f', '#2fd48c', '#e33e5a', '#0e8a6d', '#5b5bd6'];

export default function StatusPanel({ me }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');
  const [bg, setBg] = useState(TEXT_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(null); // { groups, groupIndex }
  const fileRef = useRef(null);
  const videoFileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/status/feed');
      setGroups(data.groups || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const myGroup = groups.find((g) => g.mine);
  const others = groups.filter((g) => !g.mine);
  const recent = others.filter((g) => g.hasUnviewed);
  const viewed = others.filter((g) => !g.hasUnviewed);
  // Order groups the way the panel shows them, for viewer navigation.
  const displayGroups = [...(myGroup ? [myGroup] : []), ...recent, ...viewed];

  async function postTextStatus() {
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/status', {
        method: 'POST',
        body: { type: 'text', text: text.trim(), backgroundColor: bg },
      });
      setText('');
      setTextMode(false);
      setAddOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function postMediaStatus(e, kind) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await uploadFile(file);
      if (result.messageType !== kind) {
        throw new Error(kind === 'video' ? 'Please choose a video file' : 'Please choose an image file');
      }
      await api('/api/status', {
        method: 'POST',
        body: { type: kind, mediaUrl: result.url },
      });
      setAddOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteStatus(status) {
    if (!window.confirm('Delete this status?')) return;
    try {
      await api(`/api/status/${status._id}`, { method: 'DELETE' });
      setViewer(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function markViewed(statusId) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.mine) return g;
        const statuses = g.statuses.map((s) =>
          s._id === statusId ? { ...s, viewedByMe: true } : s
        );
        return { ...g, statuses, hasUnviewed: statuses.some((s) => !s.viewedByMe) };
      })
    );
  }

  function renderGroupRow(group) {
    const latest = group.statuses[group.statuses.length - 1];
    return (
      <button
        key={group.user._id}
        className="status-row"
        onClick={() =>
          setViewer({ groups: displayGroups, groupIndex: displayGroups.indexOf(group) })
        }
      >
        <span className={`status-ring ${group.hasUnviewed ? 'unseen' : 'seen'}`}>
          <Avatar name={group.user.username} src={group.user.profilePicture} size={46} />
          {latest.type === 'video' && <span className="status-video-badge">🎥</span>}
        </span>
        <span className="conv-main">
          <span className="conv-title">{group.user.username}</span>
          <span className="conv-preview">
            {latest.type === 'video' ? '🎥 Video · ' : ''}{formatListTime(latest.createdAt)}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="status-panel">
      {error && <p className="form-error status-error">{error}</p>}

      <div className="status-my-row">
        <button
          className="status-my-main"
          onClick={() => {
            if (myGroup) {
              setViewer({ groups: displayGroups, groupIndex: 0 });
            } else {
              setAddOpen((o) => !o);
            }
          }}
        >
          <span className="status-ring seen">
            <Avatar name={me.username} src={me.profilePicture} size={46} />
            {myGroup && myGroup.statuses[myGroup.statuses.length - 1]?.type === 'video' && (
              <span className="status-video-badge">🎥</span>
            )}
          </span>
          <span className="conv-main">
            <span className="conv-title">My status</span>
            <span className="conv-preview">
              {myGroup
                ? `${myGroup.statuses.length} update${myGroup.statuses.length > 1 ? 's' : ''} · ${formatListTime(myGroup.latestAt)}`
                : 'Tap to add a status update'}
            </span>
          </span>
        </button>
        <button
          className="status-add-btn"
          title="Add status"
          onClick={() => setAddOpen((o) => !o)}
        >
          +
        </button>
      </div>

      {addOpen && (
        <div className="status-add-menu">
          <button className="btn small" onClick={() => fileRef.current?.click()} disabled={busy}>
            📷 Photo status
          </button>
          <button className="btn small" onClick={() => videoFileRef.current?.click()} disabled={busy}>
            🎥 Video status
          </button>
          <button
            className="btn small"
            onClick={() => setTextMode((t) => !t)}
            disabled={busy}
          >
            ✏️ Text status
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={(e) => postMediaStatus(e, 'image')}
          />
          <input
            ref={videoFileRef}
            type="file"
            hidden
            accept="video/mp4,video/webm,video/quicktime"
            onChange={(e) => postMediaStatus(e, 'video')}
          />
        </div>
      )}

      {textMode && (
        <div className="status-text-composer">
          <textarea
            rows={3}
            maxLength={700}
            placeholder="Type a status…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ background: bg }}
          />
          <div className="status-colors">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                className={`color-dot ${c === bg ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setBg(c)}
                title={c}
              />
            ))}
          </div>
          <button className="btn primary small" onClick={postTextStatus} disabled={busy || !text.trim()}>
            {busy ? 'Posting…' : 'Post status'}
          </button>
        </div>
      )}

      {loading && <p className="empty-note">Loading statuses…</p>}

      {recent.length > 0 && (
        <>
          <h5 className="status-section">Recent updates</h5>
          {recent.map(renderGroupRow)}
        </>
      )}
      {viewed.length > 0 && (
        <>
          <h5 className="status-section">Viewed updates</h5>
          {viewed.map(renderGroupRow)}
        </>
      )}
      {!loading && others.length === 0 && (
        <p className="empty-note">
          No updates from your contacts yet. Statuses from people you chat with appear here for 24 hours.
        </p>
      )}

      {viewer && (
        <StatusViewer
          groups={viewer.groups}
          initialGroupIndex={viewer.groupIndex}
          myId={me._id}
          onClose={() => {
            setViewer(null);
            load();
          }}
          onViewed={markViewed}
          onDelete={deleteStatus}
        />
      )}
    </div>
  );
}
