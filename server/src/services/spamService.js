/**
 * Anti-spam rate limiting (module 24). Enforced inside createMessage so the
 * REST and Socket.IO send paths can never diverge.
 *
 * Two in-memory sliding-window limits (per server process; a restart resets
 * them, which is acceptable for a basic anti-spam layer):
 *
 *  1. Volume: at most SPAM_MSG_MAX messages per SPAM_MSG_WINDOW_MS per user.
 *  2. New-account reach: accounts younger than SPAM_NEW_ACCOUNT_AGE_MS may
 *     message at most SPAM_NEW_DISTINCT_MAX distinct people (private chats)
 *     within SPAM_NEW_WINDOW_MS — the classic "fresh account blasts
 *     strangers" pattern. Group/channel posts don't consume distinct slots.
 *
 * All values are env-configurable so deployments (and tests) can tune them.
 */

const CONFIG = {
  windowMs: () => Number(process.env.SPAM_MSG_WINDOW_MS || 60_000),
  maxPerWindow: () => Number(process.env.SPAM_MSG_MAX || 240),
  newAccountAgeMs: () => Number(process.env.SPAM_NEW_ACCOUNT_AGE_MS || 60 * 60 * 1000),
  newWindowMs: () => Number(process.env.SPAM_NEW_WINDOW_MS || 60 * 60 * 1000),
  newDistinctMax: () => Number(process.env.SPAM_NEW_DISTINCT_MAX || 10),
};

// userId -> number[] (send timestamps, ascending)
const sendLog = new Map();
// userId -> { windowStart, recipients: Set<string> }
const distinctLog = new Map();

function rateLimitError(message) {
  const err = new Error(message);
  err.status = 429;
  return err;
}

function prune(timestamps, cutoff) {
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= cutoff) i += 1;
  return i ? timestamps.slice(i) : timestamps;
}

/**
 * Records (or refuses) one send. Throws a 429 error when a limit trips.
 * `distinctRecipientId` is the other user for private conversations, else
 * null. Call BEFORE persisting the message; a refused send is not counted.
 */
function checkAndRecordSend({ sender, distinctRecipientId = null, now = Date.now() }) {
  const senderId = sender._id.toString();

  // 1. Volume limit.
  const windowMs = CONFIG.windowMs();
  const kept = prune(sendLog.get(senderId) || [], now - windowMs);
  if (kept.length >= CONFIG.maxPerWindow()) {
    sendLog.set(senderId, kept);
    throw rateLimitError('You are sending messages too quickly. Please slow down.');
  }

  // 2. New-account distinct-recipient cap.
  if (distinctRecipientId && sender.createdAt) {
    const accountAge = now - new Date(sender.createdAt).getTime();
    if (accountAge < CONFIG.newAccountAgeMs()) {
      let entry = distinctLog.get(senderId);
      if (!entry || now - entry.windowStart >= CONFIG.newWindowMs()) {
        entry = { windowStart: now, recipients: new Set() };
        distinctLog.set(senderId, entry);
      }
      const target = distinctRecipientId.toString();
      if (!entry.recipients.has(target) && entry.recipients.size >= CONFIG.newDistinctMax()) {
        throw rateLimitError(
          'New accounts can only start conversations with a few people at first. Please try again later.'
        );
      }
      entry.recipients.add(target);
    }
  }

  kept.push(now);
  sendLog.set(senderId, kept);
}

// Test/maintenance hook: clears all in-memory counters.
function resetSpamCounters() {
  sendLog.clear();
  distinctLog.clear();
}

module.exports = { checkAndRecordSend, resetSpamCounters, CONFIG };
