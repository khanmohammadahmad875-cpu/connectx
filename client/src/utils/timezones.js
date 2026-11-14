// World clock helpers (module 27) — everything is computed client-side with
// Intl/IANA zones; no server or external service is involved.

// Curated list for pickers (label, IANA zone). Users share one of these as
// their profile time zone, and add any of them to their world clock.
export const TIMEZONES = [
  { label: 'Karachi, Pakistan', timeZone: 'Asia/Karachi' },
  { label: 'Islamabad, Pakistan', timeZone: 'Asia/Islamabad' },
  { label: 'Dubai, UAE', timeZone: 'Asia/Dubai' },
  { label: 'Riyadh, Saudi Arabia', timeZone: 'Asia/Riyadh' },
  { label: 'Doha, Qatar', timeZone: 'Asia/Qatar' },
  { label: 'Kuwait City, Kuwait', timeZone: 'Asia/Kuwait' },
  { label: 'Muscat, Oman', timeZone: 'Asia/Muscat' },
  { label: 'Tehran, Iran', timeZone: 'Asia/Tehran' },
  { label: 'Kabul, Afghanistan', timeZone: 'Asia/Kabul' },
  { label: 'Dhaka, Bangladesh', timeZone: 'Asia/Dhaka' },
  { label: 'Kolkata, India', timeZone: 'Asia/Kolkata' },
  { label: 'Kathmandu, Nepal', timeZone: 'Asia/Kathmandu' },
  { label: 'Colombo, Sri Lanka', timeZone: 'Asia/Colombo' },
  { label: 'Bangkok, Thailand', timeZone: 'Asia/Bangkok' },
  { label: 'Kuala Lumpur, Malaysia', timeZone: 'Asia/Kuala_Lumpur' },
  { label: 'Singapore', timeZone: 'Asia/Singapore' },
  { label: 'Jakarta, Indonesia', timeZone: 'Asia/Jakarta' },
  { label: 'Beijing, China', timeZone: 'Asia/Shanghai' },
  { label: 'Hong Kong', timeZone: 'Asia/Hong_Kong' },
  { label: 'Tokyo, Japan', timeZone: 'Asia/Tokyo' },
  { label: 'Seoul, South Korea', timeZone: 'Asia/Seoul' },
  { label: 'Sydney, Australia', timeZone: 'Australia/Sydney' },
  { label: 'Auckland, New Zealand', timeZone: 'Pacific/Auckland' },
  { label: 'Istanbul, Türkiye', timeZone: 'Europe/Istanbul' },
  { label: 'Moscow, Russia', timeZone: 'Europe/Moscow' },
  { label: 'Berlin, Germany', timeZone: 'Europe/Berlin' },
  { label: 'Paris, France', timeZone: 'Europe/Paris' },
  { label: 'Rome, Italy', timeZone: 'Europe/Rome' },
  { label: 'Madrid, Spain', timeZone: 'Europe/Madrid' },
  { label: 'London, UK', timeZone: 'Europe/London' },
  { label: 'Cairo, Egypt', timeZone: 'Africa/Cairo' },
  { label: 'Lagos, Nigeria', timeZone: 'Africa/Lagos' },
  { label: 'Johannesburg, South Africa', timeZone: 'Africa/Johannesburg' },
  { label: 'Toronto, Canada', timeZone: 'America/Toronto' },
  { label: 'New York, USA', timeZone: 'America/New_York' },
  { label: 'Chicago, USA', timeZone: 'America/Chicago' },
  { label: 'Denver, USA', timeZone: 'America/Denver' },
  { label: 'Los Angeles, USA', timeZone: 'America/Los_Angeles' },
  { label: 'São Paulo, Brazil', timeZone: 'America/Sao_Paulo' },
  { label: 'UTC', timeZone: 'UTC' },
];

export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (err) {
    return 'UTC';
  }
}

export function timeInZone(timeZone, date = new Date(), format24h = false) {
  if (!timeZone) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: !format24h,
      timeZone,
    }).format(date);
  } catch (err) {
    return '';
  }
}

export function dateInZone(timeZone, date = new Date()) {
  if (!timeZone) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone,
    }).format(date);
  } catch (err) {
    return '';
  }
}

export function zoneLabel(timeZone) {
  const found = TIMEZONES.find((z) => z.timeZone === timeZone);
  if (found) return found.label;
  return (timeZone || '').split('/').pop().replace(/_/g, ' ');
}
