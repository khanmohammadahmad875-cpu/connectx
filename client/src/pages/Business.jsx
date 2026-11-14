import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api';
import Avatar from '../components/Avatar';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function VerifiedBadge() {
  return (
    <span className="verified-badge" title="Verified by ConnectX admins">
      ✔ Verified
    </span>
  );
}

function OpenChip({ business }) {
  return (
    <span className={`open-chip ${business.isOpen ? 'open' : 'closed'}`}>
      {business.isOpen ? '● Open now' : '● Closed'}
    </span>
  );
}

function BusinessDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [messaging, setMessaging] = useState(false);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    api(`/api/business/${userId}?tz=${encodeURIComponent(tz)}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [userId]);

  async function messageBusiness() {
    setMessaging(true);
    try {
      const res = await api('/api/conversations', {
        method: 'POST',
        body: { type: 'private', participantId: userId },
      });
      sessionStorage.setItem('connectx_open_conv', res.conversation._id);
      navigate('/');
    } catch (err) {
      setError(err.message);
      setMessaging(false);
    }
  }

  if (error) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <Link to="/business" className="icon-btn">←</Link>
          <h2>Business</h2>
        </header>
        <p className="form-error">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page-shell">
        <p className="empty-note">Loading business…</p>
      </div>
    );
  }
  const b = data.business;
  const products = data.products || [];

  return (
    <div className="page-shell">
      <header className="page-header">
        <Link to="/business" className="icon-btn">←</Link>
        <h2>{b.name}</h2>
        {b.verified && <VerifiedBadge />}
      </header>

      {b.cover && <img className="biz-cover" src={b.cover} alt="" />}
      <div className="profile-card">
        <div className="profile-top">
          <Avatar name={b.name} src={b.logo || b.profilePicture} size={84} />
          <div>
            <h3>
              {b.name} {b.verified && <VerifiedBadge />}
            </h3>
            <p className="info-sub">
              {b.category || 'Business'} · by {b.username}
            </p>
            <OpenChip business={b} />
          </div>
        </div>
        {b.description && <p className="biz-description">{b.description}</p>}
        <div className="biz-contact-rows">
          {b.publicEmail && (
            <p>✉️ <a href={`mailto:${b.publicEmail}`}>{b.publicEmail}</a></p>
          )}
          {b.publicPhone && (
            <p>📞 <a href={`tel:${b.publicPhone}`}>{b.publicPhone}</a></p>
          )}
          {b.address && <p>📍 {b.address}</p>}
          {b.website && (
            <p>
              🌐{' '}
              <a href={b.website} target="_blank" rel="noreferrer">
                {b.website}
              </a>
            </p>
          )}
        </div>
        <button className="btn primary" onClick={messageBusiness} disabled={messaging}>
          {messaging ? 'Opening chat…' : '💬 Message'}
        </button>
      </div>

      {b.hours && b.hours.length > 0 && (
        <div className="profile-card">
          <h3>Working hours</h3>
          <table className="hours-table">
            <tbody>
              {b.hours.map((h) => (
                <tr key={h.day} className={h.day === new Date().getDay() ? 'today' : ''}>
                  <td>{DAY_NAMES[h.day]}</td>
                  <td>{h.closed ? 'Closed' : `${h.open} – ${h.close}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="info-sub">
            Times shown in {b.timezone ? `${b.timezone} (the business's time zone)` : 'your time zone'}.
          </p>
        </div>
      )}

      <div className="profile-card">
        <h3>Products &amp; services</h3>
        {products.length === 0 && <p className="empty-note">No products listed yet.</p>}
        <div className="product-grid">
          {products.map((p) => (
            <div key={p._id} className="product-card">
              {p.image && <img src={p.image} alt="" />}
              <strong>{p.name}</strong>
              {p.description && <p className="info-sub">{p.description}</p>}
              <span className="product-price">
                {p.currency ? `${p.currency} ` : ''}
                {p.price}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BusinessDirectory() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const params = new URLSearchParams({ tz });
      if (q.trim()) params.set('q', q.trim());
      if (category.trim()) params.set('category', category.trim());
      const data = await api(`/api/business/directory?${params.toString()}`);
      setBusinesses(data.businesses || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [q, category]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="page-shell">
      <header className="page-header">
        <Link to="/" className="icon-btn">←</Link>
        <h2>Businesses</h2>
      </header>
      <div className="biz-search-row">
        <input
          className="search-input"
          placeholder="Search businesses…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input
          className="search-input"
          placeholder="Category…"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      {loading && <p className="empty-note">Loading businesses…</p>}
      {!loading && businesses.length === 0 && (
        <p className="empty-note">
          No businesses found. Enable a business profile from your Profile page to appear here.
        </p>
      )}
      <div className="biz-directory">
        {businesses.map((b) => (
          <button
            key={b.userId}
            className="biz-card"
            onClick={() => navigate(`/business/${b.userId}`)}
          >
            <Avatar name={b.name} src={b.logo || b.profilePicture} size={52} />
            <span className="biz-card-main">
              <span className="biz-card-name">
                {b.name} {b.verified && <VerifiedBadge />}
              </span>
              <span className="info-sub">{b.category || 'Business'}</span>
              {b.description && <span className="biz-card-desc">{b.description}</span>}
            </span>
            <OpenChip business={b} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Business() {
  const { userId } = useParams();
  return userId ? <BusinessDetail /> : <BusinessDirectory />;
}
