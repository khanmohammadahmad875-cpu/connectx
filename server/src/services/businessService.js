// Business profile helpers (v3.0 module 30).
//
// Working-hours logic lives here as pure functions of (business, date,
// timeZone) so it can be unit-tested with any clock: the caller injects the
// instant, nothing here reads the wall clock on its own.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function defaultHours() {
  // Mon–Fri 09:00–17:00, weekend closed — a sensible starter the owner edits.
  return WEEKDAYS.map((_, day) => ({
    day,
    open: '09:00',
    close: '17:00',
    closed: day === 0 || day === 6,
  }));
}

// Weekday (0=Sunday) + minutes since midnight for `date` in `timeZone`.
function zonedParts(date, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(date).map((p) => [p.type, p.value])
    );
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
  } catch (err) {
    // Unknown zone: fall back to UTC rather than failing the request.
    return { day: date.getUTCDay(), minutes: date.getUTCHours() * 60 + date.getUTCMinutes() };
  }
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((n) => Number(n) || 0);
  return h * 60 + m;
}

// Is the business open at `date`? Hours are interpreted in `timeZone`
// (the business's own zone; the caller decides the fallback).
function isOpenAt(business, date = new Date(), timeZone = 'UTC') {
  const hours = (business && business.hours) || [];
  if (!hours.length) return false; // no hours published = treated as closed
  const { day, minutes } = zonedParts(date, timeZone);
  const entry = hours.find((h) => h.day === day);
  if (!entry || entry.closed) return false;
  const open = toMinutes(entry.open);
  const close = toMinutes(entry.close);
  if (close > open) return minutes >= open && minutes < close;
  // Overnight hours (e.g. 20:00–04:00): open after `open` or before `close`.
  return minutes >= open || minutes < close;
}

function serializeHours(business) {
  const stored = (business && business.hours) || [];
  if (!stored.length) return [];
  return stored
    .map((h) => ({ day: h.day, open: h.open, close: h.close, closed: !!h.closed }))
    .sort((a, b) => a.day - b.day);
}

// The business's public face. Contact fields are filtered by the owner's
// per-field visibility: everyone → any viewer; contacts → viewers sharing a
// conversation with the owner; nobody → hidden. welcome/away texts and the
// visibility map itself are never exposed.
function serializePublicBusiness(user, { isContact = false, now = new Date(), viewerTimeZone = '' } = {}) {
  const b = user.business || {};
  const zone = user.timezone || viewerTimeZone || 'UTC';
  const out = {
    userId: user._id,
    username: user.username,
    profilePicture: user.privacy?.showProfilePicture ? user.profilePicture : '',
    isBusiness: !!b.isBusiness,
    verified: !!b.verified,
    name: b.name || user.username,
    logo: b.logo || '',
    cover: b.cover || '',
    category: b.category || '',
    description: b.description || '',
    website: b.website || '',
    hours: serializeHours(b),
    timezone: user.timezone || '',
    isOpen: b.isBusiness ? isOpenAt(b, now, zone) : false,
  };
  const vis = b.visibility || {};
  const maySee = (field) => {
    const v = vis[field] || 'nobody';
    return v === 'everyone' || (v === 'contacts' && isContact);
  };
  if (b.publicEmail && maySee('email')) out.publicEmail = b.publicEmail;
  if (b.publicPhone && maySee('phone')) out.publicPhone = b.publicPhone;
  if (b.address && maySee('address')) out.address = b.address;
  return out;
}

// The owner's own full view (settings included — never served to others).
function serializeOwnBusiness(user) {
  const b = user.business || {};
  return {
    isBusiness: !!b.isBusiness,
    name: b.name || '',
    logo: b.logo || '',
    cover: b.cover || '',
    category: b.category || '',
    description: b.description || '',
    publicEmail: b.publicEmail || '',
    publicPhone: b.publicPhone || '',
    address: b.address || '',
    website: b.website || '',
    visibility: {
      email: b.visibility?.email || 'everyone',
      phone: b.visibility?.phone || 'everyone',
      address: b.visibility?.address || 'everyone',
    },
    hours: serializeHours(b),
    welcomeMessage: b.welcomeMessage || '',
    awayMessage: b.awayMessage || '',
    verified: !!b.verified,
    quickReplies: (b.quickReplies || []).map((q) => ({ title: q.title, text: q.text })),
  };
}

module.exports = {
  WEEKDAYS,
  defaultHours,
  zonedParts,
  isOpenAt,
  serializeHours,
  serializePublicBusiness,
  serializeOwnBusiness,
};
