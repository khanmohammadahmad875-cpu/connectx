import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, uploadFile } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePrefs } from '../context/PreferencesContext';
import Avatar from '../components/Avatar';
import Dock from '../components/Dock';
import { REEL_INTERESTS } from '../utils/interests';

// Reels: a TikTok-style vertical feed. Full-screen snap scrolling, the
// in-view video autoplays (tap toggles sound), off-view videos pause, and
// the next page loads as the user nears the end. The server orders the
// feed by the caller's reelInterests, so picked interests come first.
export default function Reels() {
  const { user: me } = useAuth();
  const navigate = useNavigate();

  // The bottom dock lives here too — pinned to the screen's bottom like
  // everywhere else, same card, same design (never part of the scroll).
  function handleDockNav(key) {
    if (key === 'reels') return;
    if (key === 'home') return navigate('/home');
    if (key === 'status') {
      sessionStorage.setItem('connectx_section', 'status');
    } else if (key === 'communities' || key === 'calls') {
      sessionStorage.setItem('connectx_listview', key);
    } else if (key === 'groups') {
      sessionStorage.setItem('connectx_filter', 'groups');
    }
    navigate('/');
  }
  const { prefs, save: savePrefs, loading: prefsLoading } = usePrefs();
  const [reels, setReels] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(true);
  const [picked, setPicked] = useState([]); // first-visit interest selection
  const [savingInterests, setSavingInterests] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [composer, setComposer] = useState(null); // { url } once a clip uploaded
  const [caption, setCaption] = useState('');
  const [interest, setInterest] = useState('');
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);

  const feedRef = useRef(null);
  const fileRef = useRef(null);
  const videoRefs = useRef(new Map());
  const itemRefs = useRef(new Map());
  const viewedRef = useRef(new Set());
  const startedRef = useRef(false);
  const cursorRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const reelsRef = useRef([]);
  reelsRef.current = reels;

  const myInterests = prefs?.reelInterests || [];
  const needsOnboarding = !prefsLoading && !!prefs && myInterests.length === 0 && !skipped;

  // First page — fetched once, as soon as onboarding is not in the way.
  useEffect(() => {
    if (prefsLoading || !prefs || needsOnboarding || startedRef.current) return undefined;
    startedRef.current = true;
    let cancelled = false;
    setLoadingFeed(true);
    api('/api/reels/feed')
      .then((d) => {
        if (cancelled) return;
        setReels(d.reels || []);
        cursorRef.current = d.nextCursor || null;
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingFeed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prefsLoading, prefs, needsOnboarding]);

  async function loadMore() {
    if (!cursorRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const d = await api(`/api/reels/feed?cursor=${encodeURIComponent(cursorRef.current)}`);
      cursorRef.current = d.nextCursor || null;
      setReels((prev) => [...prev, ...(d.reels || [])]);
    } catch {
      /* keep the cursor — a later scroll into view retries */
    } finally {
      loadingMoreRef.current = false;
    }
  }
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  // Autoplay/pause + view counting + endless trigger, driven by visibility.
  useEffect(() => {
    if (!reels.length) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.dataset.reelId;
          const video = videoRefs.current.get(id);
          if (entry.intersectionRatio >= 0.6) {
            if (video) {
              video.muted = muted;
              video.play().catch(() => {});
            }
            if (!viewedRef.current.has(id)) {
              viewedRef.current.add(id);
              api(`/api/reels/${id}/view`, { method: 'POST' }).catch(() => {});
              setReels((prev) =>
                prev.map((r) => (r._id === id ? { ...r, views: (r.views || 0) + 1 } : r))
              );
            }
            const idx = reelsRef.current.findIndex((r) => r._id === id);
            if (idx >= reelsRef.current.length - 2) loadMoreRef.current();
          } else if (video) {
            video.pause();
          }
        }
      },
      { root: feedRef.current, threshold: [0, 0.6] }
    );
    itemRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // `muted` is read fresh inside the callback; re-observing on reel-list
    // changes is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reels]);

  // Keep the audible state in sync when the user toggles sound.
  useEffect(() => {
    videoRefs.current.forEach((video) => {
      video.muted = muted;
    });
  }, [muted]);

  async function saveOnboarding() {
    setSavingInterests(true);
    try {
      await savePrefs({ reelInterests: picked });
    } catch (err) {
      setError(err.message);
      setSavingInterests(false);
    }
  }

  async function toggleLike(reel) {
    try {
      const d = await api(`/api/reels/${reel._id}/like`, { method: 'POST' });
      setReels((prev) =>
        prev.map((r) => (r._id === reel._id ? { ...r, likedByMe: d.liked, likesCount: d.likesCount } : r))
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteReel(reel) {
    if (!window.confirm('Delete this reel?')) return;
    try {
      await api(`/api/reels/${reel._id}`, { method: 'DELETE' });
      setReels((prev) => prev.filter((r) => r._id !== reel._id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function pickVideo(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const result = await uploadFile(file);
      if (result.messageType !== 'video') throw new Error('Please choose a video file');
      setComposer({ url: result.url });
      setCaption('');
      setInterest('');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function postReel() {
    if (!composer) return;
    if (!interest) {
      setError('Pick an interest for your reel');
      return;
    }
    setPosting(true);
    setError('');
    try {
      const d = await api('/api/reels', {
        method: 'POST',
        body: { videoUrl: composer.url, caption: caption.trim(), interest },
      });
      setReels((prev) => [d.reel, ...prev]);
      setComposer(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  }

  const header = (
    <header className="reels-header">
      <Link to="/home" className="icon-btn" aria-label="Back to home">←</Link>
      <h2>Reels</h2>
      <span className="spacer" />
      <button
        className="btn small primary"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? 'Uploading…' : '+ Create'}
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
        onChange={pickVideo}
      />
    </header>
  );

  if (prefsLoading || !prefs) {
    return (
      <div className="reels-shell">
        {header}
        <p className="empty-note center">Loading Reels…</p>
        <Dock active="reels" onNavigate={handleDockNav} />
      </div>
    );
  }

  if (needsOnboarding) {
    return (
      <div className="reels-shell">
        {header}
        <div className="reels-onboarding">
          <h2>What are you interested in?</h2>
          <p className="info-sub">
            Pick a few topics — reels about them will show first in your feed. You can change this
            later in Settings → Interests.
          </p>
          {error && <p className="form-error">{error}</p>}
          <div className="interest-chips">
            {REEL_INTERESTS.map((name) => {
              const on = picked.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={`interest-chip ${on ? 'selected' : ''}`}
                  onClick={() =>
                    setPicked((prev) => (on ? prev.filter((x) => x !== name) : [...prev, name]))
                  }
                >
                  {name}
                </button>
              );
            })}
          </div>
          <button className="btn primary" onClick={saveOnboarding} disabled={!picked.length || savingInterests}>
            {savingInterests ? 'Saving…' : 'Continue'}
          </button>
          <button className="btn ghost" onClick={() => setSkipped(true)} disabled={savingInterests}>
            Skip for now
          </button>
        </div>
        <Dock active="reels" onNavigate={handleDockNav} />
      </div>
    );
  }

  return (
    <div className="reels-shell">
      {header}
      {error && <p className="form-error reels-error">{error}</p>}

      {composer && (
        <div className="reel-composer">
          <video className="reel-composer-preview" src={composer.url} controls playsInline />
          <input
            className="text-input"
            placeholder="Write a caption…"
            maxLength={500}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <div className="interest-chips">
            {REEL_INTERESTS.map((name) => (
              <button
                key={name}
                type="button"
                className={`interest-chip ${interest === name ? 'selected' : ''}`}
                onClick={() => setInterest(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="reel-composer-actions">
            <button className="btn ghost" onClick={() => setComposer(null)} disabled={posting}>
              Cancel
            </button>
            <button className="btn primary" onClick={postReel} disabled={posting || !interest}>
              {posting ? 'Posting…' : 'Post reel'}
            </button>
          </div>
        </div>
      )}

      {loadingFeed ? (
        <p className="empty-note center">Loading Reels…</p>
      ) : reels.length === 0 && !composer ? (
        <div className="reels-empty">
          <p className="empty-note">No reels yet — be the first to post one!</p>
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
            🎬 Upload the first reel
          </button>
        </div>
      ) : (
        <div className="reels-feed" ref={feedRef}>
          {reels.map((r) => {
            const author = typeof r.author === 'object' && r.author ? r.author : {};
            const canDelete = author._id === me._id || me.role === 'admin';
            return (
              <div
                className="reel-item"
                key={r._id}
                data-reel-id={r._id}
                ref={(el) => {
                  if (el) itemRefs.current.set(r._id, el);
                  else itemRefs.current.delete(r._id);
                }}
              >
                <video
                  className="reel-video"
                  src={r.videoUrl}
                  loop
                  playsInline
                  muted={muted}
                  preload="metadata"
                  onClick={() => setMuted((m) => !m)}
                  ref={(el) => {
                    if (el) videoRefs.current.set(r._id, el);
                    else videoRefs.current.delete(r._id);
                  }}
                />
                <div className="reel-rail">
                  <span className="reel-author-badge">
                    <Avatar name={author.username || '?'} src={author.profilePicture} size={44} />
                  </span>
                  <button
                    type="button"
                    className={`reel-action ${r.likedByMe ? 'liked' : ''}`}
                    onClick={() => toggleLike(r)}
                    aria-label="Like"
                  >
                    <span className="reel-action-icon">{r.likedByMe ? '❤️' : '🤍'}</span>
                    <span className="reel-action-count">{r.likesCount || 0}</span>
                  </button>
                  <span className="reel-action static">
                    <span className="reel-action-icon">👁</span>
                    <span className="reel-action-count">{r.views || 0}</span>
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      className="reel-action"
                      onClick={() => deleteReel(r)}
                      aria-label="Delete reel"
                    >
                      <span className="reel-action-icon">🗑</span>
                    </button>
                  )}
                </div>
                <div className="reel-meta">
                  <div className="reel-author-name">@{author.username || 'unknown'}</div>
                  <span className="reel-interest-chip">{r.interest}</span>
                  {r.caption && <p className="reel-caption">{r.caption}</p>}
                  <span className="reel-sound-hint">{muted ? '🔇 Tap for sound' : '🔊 Sound on'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dock active="reels" onNavigate={handleDockNav} />
    </div>
  );
}
