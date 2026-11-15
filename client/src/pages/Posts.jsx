import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, uploadFile } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePrefs } from '../context/PreferencesContext';
import { useLiveWeather } from '../hooks/useLiveWeather';
import Avatar from '../components/Avatar';
import Dock from '../components/Dock';
import WeatherScene from '../components/WeatherScene';
import { formatListTime } from '../utils/format';

// Posts: a Facebook-style feed. Anyone signed in can post text and/or a
// photo, and every post is visible to all users — like, comment, and
// delete-your-own included. Photos go through the existing uploads
// pipeline; the feed itself is plain REST (no live socket needed).
export default function Posts() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const { prefs } = usePrefs();
  const liveWeather = useLiveWeather();

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState(null); // { url } after upload
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef(null);

  const [openComments, setOpenComments] = useState(() => new Set());
  const [commentDrafts, setCommentDrafts] = useState({});
  const [viewing, setViewing] = useState(null); // image url in the lightbox

  function handleDockNav(key) {
    if (key === 'posts') return;
    if (key === 'home') return navigate('/home');
    if (key === 'reels') return navigate('/reels');
    if (key === 'status') {
      sessionStorage.setItem('connectx_section', 'status');
    } else if (key === 'communities' || key === 'calls') {
      sessionStorage.setItem('connectx_listview', key);
    } else if (key === 'groups') {
      sessionStorage.setItem('connectx_filter', 'groups');
    }
    navigate('/');
  }

  const loadFeed = useCallback(async (whichPage) => {
    const data = await api(`/api/posts/feed?page=${whichPage}`);
    return data;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await loadFeed(1);
        setPosts(data.posts || []);
        setHasMore(!!data.hasMore);
        setPage(1);
      } catch (err) {
        setError(err.message || 'Posts load nahi ho sakeen.');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadFeed]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await loadFeed(next);
      setPosts((prev) => [...prev, ...(data.posts || [])]);
      setHasMore(!!data.hasMore);
      setPage(next);
    } catch (err) {
      setError(err.message || 'Aur posts load nahi ho sakeen.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function pickPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const result = await uploadFile(file);
      if (result.messageType !== 'image') {
        setError('Sirf photo select karo — video ke liye Reels hai.');
        return;
      }
      setPhoto({ url: result.url });
    } catch (err) {
      setError(err.message || 'Photo upload nahi ho saki.');
    } finally {
      setUploading(false);
    }
  }

  async function publish() {
    const text = draft.trim();
    if (!text && !photo) return;
    setPosting(true);
    setError('');
    try {
      const data = await api('/api/posts', {
        method: 'POST',
        body: { text, imageUrl: photo ? photo.url : '' },
      });
      setPosts((prev) => [data.post, ...prev]);
      setDraft('');
      setPhoto(null);
    } catch (err) {
      setError(err.message || 'Post nahi ho saki.');
    } finally {
      setPosting(false);
    }
  }

  async function toggleLike(post) {
    // Optimistic — the server reply reconciles the count.
    setPosts((prev) =>
      prev.map((p) =>
        p._id === post._id
          ? {
              ...p,
              likedByMe: !p.likedByMe,
              likesCount: p.likesCount + (p.likedByMe ? -1 : 1),
            }
          : p
      )
    );
    try {
      const data = await api(`/api/posts/${post._id}/like`, { method: 'POST' });
      setPosts((prev) =>
        prev.map((p) =>
          p._id === post._id ? { ...p, likesCount: data.likesCount, likedByMe: data.likedByMe } : p
        )
      );
    } catch (err) {
      setPosts((prev) =>
        prev.map((p) =>
          p._id === post._id
            ? {
                ...p,
                likedByMe: post.likedByMe,
                likesCount: post.likesCount,
              }
            : p
        )
      );
    }
  }

  function toggleComments(postId) {
    setOpenComments((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  async function sendComment(post) {
    const text = (commentDrafts[post._id] || '').trim();
    if (!text) return;
    try {
      const data = await api(`/api/posts/${post._id}/comments`, {
        method: 'POST',
        body: { text },
      });
      setPosts((prev) =>
        prev.map((p) =>
          p._id === post._id
            ? { ...p, comments: [...(p.comments || []), data.comment], commentsCount: data.commentsCount }
            : p
        )
      );
      setCommentDrafts((prev) => ({ ...prev, [post._id]: '' }));
    } catch (err) {
      setError(err.message || 'Comment nahi ho saka.');
    }
  }

  async function deletePost(post) {
    try {
      await api(`/api/posts/${post._id}`, { method: 'DELETE' });
      setPosts((prev) => prev.filter((p) => p._id !== post._id));
    } catch (err) {
      setError(err.message || 'Post delete nahi ho saki.');
    }
  }

  const ambientScene =
    prefs?.liveWeatherBackground !== false && liveWeather ? liveWeather.scene : null;

  return (
    <div className={`dash-shell ${ambientScene ? 'scene-on' : ''}`}>
      {ambientScene && (
        <WeatherScene
          scene={ambientScene}
          night={liveWeather ? !liveWeather.isDay : false}
          className="dash-scene"
        />
      )}
      <header className="dash-header">
        <div className="brand">
          <span className="brand-mark">CX</span>
          <span className="brand-text">
            <span className="brand-name">ConnectX</span>
            <span className="brand-sub">by Developer Mohammad Ahmad Khan</span>
          </span>
        </div>
        <nav className="dash-nav">
          <Link className="btn small ghost" to="/">💬 Chats</Link>
          <Link className="btn small ghost" to="/home">🏠 Home</Link>
          <Link className="btn small ghost" to="/profile">Profile</Link>
        </nav>
      </header>

      <main className="posts-wrap">
        <h1 className="posts-title">📝 Posts</h1>
        {error && <p className="form-error">{error}</p>}

        <section className="post-card composer-card">
          <div className="composer-row">
            <Avatar name={me?.username} src={me?.profilePicture} size={42} />
            <textarea
              className="composer-input"
              rows={2}
              maxLength={2000}
              placeholder={`What's on your mind, ${me?.username || 'friend'}?`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          {photo && (
            <div className="composer-preview">
              <img src={photo.url} alt="Selected" />
              <button type="button" className="composer-preview-x" onClick={() => setPhoto(null)}>
                ✕
              </button>
            </div>
          )}
          <div className="composer-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={uploading}
            >
              📷 {uploading ? 'Uploading…' : 'Photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
            <button
              type="button"
              className="btn primary"
              onClick={publish}
              disabled={posting || uploading || (!draft.trim() && !photo)}
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </section>

        {loading && <p className="empty-note">Posts load ho rahi hain…</p>}
        {!loading && posts.length === 0 && (
          <p className="empty-note">Abhi koi post nahi — pehli post tum karo! 🎉</p>
        )}

        <div className="posts-feed">
          {posts.map((post) => {
            const mine = post.author?._id === me?._id;
            const commentsOpen = openComments.has(post._id);
            return (
              <article key={post._id} className="post-card">
                <div className="post-head">
                  <Avatar name={post.author?.username} src={post.author?.profilePicture} size={42} />
                  <div className="post-head-text">
                    <span className="post-author">{post.author?.username || 'Someone'}</span>
                    <span className="post-time">{formatListTime(post.createdAt)}</span>
                  </div>
                  {(mine || me?.role === 'admin') && (
                    <button
                      type="button"
                      className="icon-btn post-delete"
                      title="Delete post"
                      onClick={() => deletePost(post)}
                    >
                      🗑
                    </button>
                  )}
                </div>

                {post.text && <p className="post-text">{post.text}</p>}
                {post.imageUrl && (
                  <button type="button" className="post-image-btn" onClick={() => setViewing(post.imageUrl)}>
                    <img className="post-image" src={post.imageUrl} alt="Post" loading="lazy" />
                  </button>
                )}

                <div className="post-actions">
                  <button
                    type="button"
                    className={`post-action-btn ${post.likedByMe ? 'liked' : ''}`}
                    onClick={() => toggleLike(post)}
                  >
                    {post.likedByMe ? '❤️' : '🤍'} {post.likesCount} Like
                  </button>
                  <button
                    type="button"
                    className="post-action-btn"
                    onClick={() => toggleComments(post._id)}
                  >
                    💬 {post.commentsCount} Comment
                  </button>
                </div>

                {commentsOpen && (
                  <div className="post-comments">
                    {(post.comments || []).map((c) => (
                      <div key={c._id} className="post-comment">
                        <Avatar name={c.user?.username} src={c.user?.profilePicture} size={28} />
                        <div className="post-comment-body">
                          <span className="post-comment-author">{c.user?.username || 'Someone'}</span>
                          <span className="post-comment-text">{c.text}</span>
                        </div>
                      </div>
                    ))}
                    <div className="post-comment-form">
                      <input
                        className="text-input"
                        placeholder="Write a comment…"
                        maxLength={500}
                        value={commentDrafts[post._id] || ''}
                        onChange={(e) =>
                          setCommentDrafts((prev) => ({ ...prev, [post._id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') sendComment(post);
                        }}
                      />
                      <button type="button" className="btn small primary" onClick={() => sendComment(post)}>
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {hasMore && (
          <button type="button" className="btn ghost posts-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more posts'}
          </button>
        )}
      </main>

      {viewing && (
        <div className="img-viewer" role="dialog" aria-modal="true" onClick={() => setViewing(null)}>
          <img className="img-viewer-img" src={viewing} alt="Post full view" />
          <button type="button" className="img-viewer-close" onClick={() => setViewing(null)} aria-label="Close">
            ✕
          </button>
        </div>
      )}

      <Dock active="posts" onNavigate={handleDockNav} />
    </div>
  );
}
