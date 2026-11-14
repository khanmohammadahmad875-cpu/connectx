const Event = require('../models/Event');
const Notification = require('../models/Notification');

/**
 * Event reminders (module 31).
 *
 * A lightweight interval checker: every EVENT_REMINDER_INTERVAL_MS
 * (default 30 s) it looks for events starting soon whose reminder time
 * (startAt - reminderMinutes) has passed, and creates one in-app
 * notification per participant per reminder offset. Bookkeeping lives on
 * the event (`remindersSent` keys), so a reminder is never sent twice.
 *
 * Honest limits: the checker is in-memory scheduling only — if the server
 * is down when a reminder falls due, it fires on the next run as long as
 * the event has not been over for more than 30 minutes; the event data
 * itself is fully persistent.
 */

const INTERVAL_MS = () => Number(process.env.EVENT_REMINDER_INTERVAL_MS || 30_000);
const STALE_AFTER_MS = 30 * 60 * 1000;

async function runReminderCheck(now = new Date()) {
  const maxMinutes = 24 * 60; // reminders are at most a day out in practice
  const horizon = new Date(now.getTime() + maxMinutes * 60 * 1000);
  const events = await Event.find({
    startAt: { $gte: new Date(now.getTime() - STALE_AFTER_MS), $lte: horizon },
  }).select('+remindersSent');

  let fired = 0;
  for (const event of events) {
    const recipients = new Map(); // userId -> attendee status ('creator' for the creator)
    recipients.set(event.creator.toString(), 'creator');
    for (const attendee of event.attendees || []) {
      if (attendee.status !== 'declined') recipients.set(attendee.user.toString(), attendee.status);
    }

    let changed = false;
    for (const minutes of event.reminderMinutes || []) {
      const fireAt = new Date(event.startAt.getTime() - minutes * 60 * 1000);
      if (fireAt > now) continue;
      for (const userId of recipients.keys()) {
        const key = `${userId}:${minutes}`;
        if (event.remindersSent.includes(key)) continue;
        await Notification.create({
          recipientId: userId,
          senderId: event.creator,
          type: 'event_reminder',
          eventId: event._id,
          text: `Reminder: “${event.title}” starts in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        });
        event.remindersSent.push(key);
        changed = true;
        fired += 1;
      }
    }
    if (changed) await event.save();
  }
  return fired;
}

let timer = null;

function startReminderChecker() {
  if (timer) return timer;
  const tick = () => {
    runReminderCheck().catch((err) => console.error('[reminders]', err.message));
  };
  timer = setInterval(tick, INTERVAL_MS());
  if (timer.unref) timer.unref();
  return timer;
}

function stopReminderChecker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runReminderCheck, startReminderChecker, stopReminderChecker };
