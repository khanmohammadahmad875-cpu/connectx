/**
 * Link safety (module 24) — deliberately lightweight: links are never
 * blocked, only *flagged* so the client can show the bare domain and a
 * subtle warning marker. A link is flagged when its host is a known URL
 * shortener (the real destination is hidden) or a punycode ("xn--") host
 * (internationalised domains are a classic look-alike/phishing vector).
 */

const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'rb.gy',
  'ow.ly',
  'is.gd',
  'cutt.ly',
  'tiny.cc',
  'shorturl.at',
  'rebrand.ly',
  'bl.ink',
  'short.io',
  's.id',
  'v.gd',
  'qr.ae',
  'buff.ly',
]);

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

function analyzeLinks(content) {
  if (!content || typeof content !== 'string') return [];
  const found = [];
  const seen = new Set();
  for (const match of content.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,!?;:]+$/, ''); // trailing sentence punctuation
    if (seen.has(url)) continue;
    seen.add(url);
    let domain = '';
    let flagged = false;
    const reasons = [];
    try {
      const parsed = new URL(url);
      domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (SHORTENER_HOSTS.has(domain)) {
        flagged = true;
        reasons.push('url-shortener');
      }
      if (domain.split('.').some((label) => label.startsWith('xn--'))) {
        flagged = true;
        reasons.push('punycode-domain');
      }
    } catch (err) {
      continue; // not a parseable URL — nothing to flag
    }
    found.push({ url, domain, flagged, reasons });
    if (found.length >= 10) break; // cap the work per message
  }
  return found;
}

module.exports = { analyzeLinks, SHORTENER_HOSTS };
