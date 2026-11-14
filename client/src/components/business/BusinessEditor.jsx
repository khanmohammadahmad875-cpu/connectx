import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, uploadFile } from '../../services/api';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const VIS_OPTIONS = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'Contacts only' },
  { value: 'nobody', label: 'Only me' },
];

const EMPTY_PRODUCT = { name: '', description: '', price: '', currency: '', image: '' };

// Business profile editor (module 30) — lives on the Profile page. Covers
// the profile fields, per-field contact visibility, working hours, welcome
// & away messages, quick replies and the product catalogue. The verified
// badge is NOT here: only admins can set it.
export default function BusinessEditor() {
  const [biz, setBiz] = useState(null);
  const [products, setProducts] = useState([]);
  const [draft, setDraft] = useState(EMPTY_PRODUCT);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const logoRef = useRef(null);
  const coverRef = useRef(null);
  const productImgRef = useRef(null);

  useEffect(() => {
    api('/api/business/me')
      .then((d) => setBiz(d.business))
      .catch(() => {});
    api('/api/business/me/products')
      .then((d) => setProducts(d.products || []))
      .catch(() => {});
  }, []);

  function set(key, value) {
    setBiz((prev) => ({ ...prev, [key]: value }));
  }
  function setVis(key, value) {
    setBiz((prev) => ({ ...prev, visibility: { ...prev.visibility, [key]: value } }));
  }
  function setHour(day, patch) {
    setBiz((prev) => {
      const hours = DAY_NAMES.map((_, d) => {
        const existing = (prev.hours || []).find((h) => h.day === d);
        return existing || { day: d, open: '09:00', close: '17:00', closed: d === 0 || d === 6 };
      }).map((h) => (h.day === day ? { ...h, ...patch } : h));
      return { ...prev, hours };
    });
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      const payload = { ...biz };
      delete payload.verified; // read-only; admins control the badge
      const data = await api('/api/business/me', { method: 'PATCH', body: payload });
      setBiz(data.business);
      setNote('Business profile saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadInto(key, file) {
    if (!file) return;
    try {
      const result = await uploadFile(file);
      set(key, result.url);
    } catch (err) {
      setError(err.message);
    }
  }

  function setQuickReply(idx, patch) {
    setBiz((prev) => ({
      ...prev,
      quickReplies: (prev.quickReplies || []).map((q, i) => (i === idx ? { ...q, ...patch } : q)),
    }));
  }

  async function addProduct(e) {
    e.preventDefault();
    setError('');
    try {
      const data = await api('/api/business/products', {
        method: 'POST',
        body: {
          name: draft.name.trim(),
          description: draft.description,
          price: Number(draft.price) || 0,
          currency: draft.currency,
          image: draft.image,
        },
      });
      setProducts((prev) => [data.product, ...prev]);
      setDraft(EMPTY_PRODUCT);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeProduct(id) {
    try {
      await api(`/api/business/products/${id}`, { method: 'DELETE' });
      setProducts((prev) => prev.filter((p) => p._id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  if (!biz) {
    return (
      <div className="profile-card">
        <h3>Business profile</h3>
        <div className="skeleton line w60" />
      </div>
    );
  }

  const hoursByDay = DAY_NAMES.map((_, d) => {
    const existing = (biz.hours || []).find((h) => h.day === d);
    return existing || { day: d, open: '09:00', close: '17:00', closed: d === 0 || d === 6 };
  });

  return (
    <div className="profile-card">
      <h3>Business profile {biz.verified && <span className="verified-badge" title="Verified by ConnectX admins">✔ Verified</span>}</h3>
      <p className="info-sub">
        Turn your profile into a business page with a public catalogue, working hours and
        automatic welcome/away messages. Your page appears in the{' '}
        <Link to="/business">business directory</Link>. The verified badge is granted by
        ConnectX admins only.
      </p>
      <form onSubmit={save} className="profile-form">
        {error && <p className="form-error">{error}</p>}
        {note && <p className="ok-note">{note}</p>}
        <label className="switch-row">
          <span>Enable business profile</span>
          <input
            type="checkbox"
            checked={!!biz.isBusiness}
            onChange={(e) => set('isBusiness', e.target.checked)}
          />
        </label>
        {biz.isBusiness && (
          <>
            <div className="biz-media-row">
              <div>
                <span className="info-sub">Logo</span>
                {biz.logo ? <img className="biz-logo-thumb" src={biz.logo} alt="Business logo" /> : <p className="empty-note">No logo</p>}
                <button type="button" className="btn small ghost" onClick={() => logoRef.current?.click()}>
                  Upload logo
                </button>
                <input ref={logoRef} type="file" hidden accept="image/*" onChange={(e) => { uploadInto('logo', e.target.files?.[0]); e.target.value = ''; }} />
              </div>
              <div>
                <span className="info-sub">Cover</span>
                {biz.cover ? <img className="biz-cover-thumb" src={biz.cover} alt="Business cover" /> : <p className="empty-note">No cover</p>}
                <button type="button" className="btn small ghost" onClick={() => coverRef.current?.click()}>
                  Upload cover
                </button>
                <input ref={coverRef} type="file" hidden accept="image/*" onChange={(e) => { uploadInto('cover', e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            </div>
            <label>
              Business name
              <input value={biz.name} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Ahmad's Web Studio" />
            </label>
            <label>
              Category
              <input value={biz.category} maxLength={60} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Web development, Bakery, Tutoring…" />
            </label>
            <label>
              Description
              <textarea rows={3} maxLength={1000} value={biz.description} onChange={(e) => set('description', e.target.value)} />
            </label>
            <label>
              Website
              <input value={biz.website} maxLength={200} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
            </label>
            {[
              ['publicEmail', 'Public email', 'email', biz.visibility?.email],
              ['publicPhone', 'Public phone', 'phone', biz.visibility?.phone],
              ['address', 'Business address', 'address', biz.visibility?.address],
            ].map(([key, label, visKey, visVal]) => (
              <div className="cc-edit-row" key={key}>
                <label className="cc-edit-main">
                  {label}
                  <input value={biz[key] || ''} onChange={(e) => set(key, e.target.value)} />
                </label>
                <select
                  className="text-input cc-vis"
                  aria-label={`Who can see my ${label}`}
                  value={visVal || 'everyone'}
                  onChange={(e) => setVis(visKey, e.target.value)}
                >
                  {VIS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            ))}

            <h4 className="appearance-sub">Working hours</h4>
            <div className="hours-editor">
              {hoursByDay.map((h) => (
                <div className="hour-row" key={h.day}>
                  <span className="hour-day">{DAY_NAMES[h.day].slice(0, 3)}</span>
                  <label className="hour-closed">
                    <input
                      type="checkbox"
                      checked={!!h.closed}
                      onChange={(e) => setHour(h.day, { closed: e.target.checked })}
                    />{' '}
                    Closed
                  </label>
                  <input type="time" value={h.open} disabled={h.closed} onChange={(e) => setHour(h.day, { open: e.target.value })} />
                  <span>–</span>
                  <input type="time" value={h.close} disabled={h.closed} onChange={(e) => setHour(h.day, { close: e.target.value })} />
                </div>
              ))}
            </div>

            <label>
              Welcome message (sent once when someone messages you first)
              <textarea rows={2} maxLength={500} value={biz.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} placeholder="Thanks for contacting us! How can we help?" />
            </label>
            <label>
              Away message (sent outside working hours, at most once a day per chat)
              <textarea rows={2} maxLength={500} value={biz.awayMessage} onChange={(e) => set('awayMessage', e.target.value)} placeholder="We are closed right now and will reply during working hours." />
            </label>

            <h4 className="appearance-sub">Quick replies</h4>
            {(biz.quickReplies || []).map((q, i) => (
              <div className="quick-reply-edit" key={i}>
                <input
                  value={q.title}
                  maxLength={60}
                  placeholder="Shortcut title"
                  onChange={(e) => setQuickReply(i, { title: e.target.value })}
                />
                <input
                  value={q.text}
                  maxLength={1000}
                  placeholder="Message text"
                  onChange={(e) => setQuickReply(i, { text: e.target.value })}
                />
                <button
                  type="button"
                  className="mini-btn danger"
                  onClick={() =>
                    setBiz((prev) => ({
                      ...prev,
                      quickReplies: (prev.quickReplies || []).filter((_, j) => j !== i),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn small ghost"
              onClick={() =>
                setBiz((prev) => ({
                  ...prev,
                  quickReplies: [...(prev.quickReplies || []), { title: '', text: '' }],
                }))
              }
            >
              + Add quick reply
            </button>
          </>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save business profile'}
        </button>
      </form>

      {biz.isBusiness && (
        <div className="biz-products">
          <h4 className="appearance-sub">Products &amp; services</h4>
          {products.length === 0 && <p className="empty-note">No products yet.</p>}
          {products.map((p) => (
            <div key={p._id} className="member-row">
              {p.image && <img className="product-thumb" src={p.image} alt="" />}
              <span className="member-name">
                {p.name} — {p.currency ? `${p.currency} ` : ''}{p.price}
              </span>
              <button className="mini-btn danger" onClick={() => removeProduct(p._id)}>
                Delete
              </button>
            </div>
          ))}
          <form onSubmit={addProduct} className="product-form">
            <input placeholder="Name" value={draft.name} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} required />
            <input placeholder="Price" type="number" min="0" step="any" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} required />
            <input placeholder="Currency (e.g. PKR, $)" value={draft.currency} maxLength={8} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))} />
            <input placeholder="Description (optional)" value={draft.description} maxLength={500} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
            <span className="product-img-row">
              <button type="button" className="btn small ghost" onClick={() => productImgRef.current?.click()}>
                {draft.image ? 'Change image' : 'Add image'}
              </button>
              <input
                ref={productImgRef}
                type="file"
                hidden
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    const result = await uploadFile(file);
                    setDraft((d) => ({ ...d, image: result.url }));
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              />
              {draft.image && <img className="product-thumb" src={draft.image} alt="" />}
            </span>
            <button className="btn small primary" type="submit">Add product</button>
          </form>
        </div>
      )}
    </div>
  );
}
