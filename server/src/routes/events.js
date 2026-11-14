const express = require('express');
const { z } = require('zod');
const Event = require('../models/Event');
const User = require('../models/User');
const ConversationMember = require('../models/ConversationMember');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

// "Contacts" rule (same as contact cards): invitees must share at least one
// conversation with the creator — you cannot invite strangers.
async function sharesConversation(userA, userB) {
  const mine = await ConversationMember.find({ userId: userA }).select('conversationId');
  if (!mine.length) return false;
  const hit = await ConversationMember.findOne({
    conversationId: { $in: mine.map((m) => m.conversationId) },
    userId: userB,
  }).select('_id');
  return !!hit;
}

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
}

function serialize(event) {
  const obj = event.toObject ? event.toObject() : event;
  delete obj.remindersSent;
  return obj;
}

// Normalises an id-like value (ObjectId or populated document) to its hex
// string — a populated doc's .toString() is not its id.
function asId(value) {
  if (value == null) return '';
  if (typeof value === 'object' && '_id' in value && typeof value._id !== 'undefined') {
    return value._id.toString();
  }
  return value.toString();
}

function involvement(event, userId) {
  if (asId(event.creator) === asId(userId)) return 'creator';
  const attendee = (event.attendees || []).find((a) => asId(a.user) === asId(userId));
  return attendee ? attendee.status : null;
}

const eventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  timezone: z.string().max(64).optional().default('UTC'),
  location: z.string().max(300).optional().default(''),
  meetingLink: z.string().max(500).optional().default(''),
  reminderMinutes: z.array(z.number().int().min(0).max(10080)).max(5).optional().default([15]),
  inviteeIds: z.array(z.string()).max(50).optional().default([]),
});

async function validateInvitees(creatorId, inviteeIds) {
  const unique = [...new Set(inviteeIds.map(String))].filter((id) => id !== creatorId.toString());
  const attendees = [];
  for (const id of unique) {
    const user = await User.findById(id).select('_id');
    if (!user) {
      const err = new Error(`Invitee not found: ${id}`);
      err.status = 400;
      throw err;
    }
    if (!(await sharesConversation(creatorId, user._id))) {
      const err = new Error('You can only invite people you share a conversation with');
      err.status = 400;
      throw err;
    }
    attendees.push({ user: user._id, status: 'invited' });
  }
  return attendees;
}

function validateTimesAndZone(body) {
  const startAt = new Date(body.startAt);
  const endAt = new Date(body.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    const err = new Error('endAt must be after startAt');
    err.status = 400;
    throw err;
  }
  if (!isValidTimeZone(body.timezone)) {
    const err = new Error(`Invalid IANA timezone: ${body.timezone}`);
    err.status = 400;
    throw err;
  }
  return { startAt, endAt };
}

router.post('/', validate(eventSchema), async (req, res, next) => {
  try {
    const { startAt, endAt } = validateTimesAndZone(req.body);
    const attendees = await validateInvitees(req.user._id, req.body.inviteeIds);
    const event = await Event.create({
      creator: req.user._id,
      title: req.body.title,
      description: req.body.description,
      startAt,
      endAt,
      timezone: req.body.timezone,
      location: req.body.location,
      meetingLink: req.body.meetingLink,
      reminderMinutes: req.body.reminderMinutes,
      attendees,
    });
    await event.populate('attendees.user', 'username profilePicture');
    return res.status(201).json({ event: serialize(event) });
  } catch (err) {
    return next(err);
  }
});

// List: events I created or am invited to. `?upcoming=true` returns events
// that have not ended yet, soonest first (the dashboard widget uses it);
// `?from=`/`?to=` bound the start time for calendar rendering.
router.get('/', async (req, res, next) => {
  try {
    const filter = {
      $or: [{ creator: req.user._id }, { 'attendees.user': req.user._id }],
    };
    if (req.query.upcoming === 'true') {
      filter.endAt = { $gte: new Date() };
    }
    if (req.query.from || req.query.to) {
      filter.startAt = {};
      if (req.query.from) filter.startAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.startAt.$lte = new Date(req.query.to);
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const events = await Event.find(filter)
      .sort({ startAt: 1 })
      .limit(limit)
      .populate('creator', 'username profilePicture')
      .populate('attendees.user', 'username profilePicture');
    return res.json({ events: events.map(serialize) });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('creator', 'username profilePicture')
      .populate('attendees.user', 'username profilePicture');
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (!involvement(event, req.user._id)) {
      return res.status(403).json({ message: 'You are not part of this event' });
    }
    return res.json({ event: serialize(event) });
  } catch (err) {
    return next(err);
  }
});

const updateSchema = eventSchema.partial().omit({ inviteeIds: true }).extend({
  inviteeIds: z.array(z.string()).max(50).optional(),
});

router.patch('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the event creator can edit this event' });
    }
    const body = { ...req.body };
    if (body.startAt || body.endAt) {
      const merged = {
        startAt: body.startAt || event.startAt.toISOString(),
        endAt: body.endAt || event.endAt.toISOString(),
        timezone: body.timezone || event.timezone,
      };
      const { startAt, endAt } = validateTimesAndZone(merged);
      body.startAt = startAt;
      body.endAt = endAt;
    }
    if (body.timezone && !isValidTimeZone(body.timezone)) {
      return res.status(400).json({ message: `Invalid IANA timezone: ${body.timezone}` });
    }
    if (body.inviteeIds) {
      // Replacing the invitee list keeps existing responses where possible.
      const attendees = await validateInvitees(req.user._id, body.inviteeIds);
      const previous = new Map((event.attendees || []).map((a) => [a.user.toString(), a.status]));
      for (const attendee of attendees) {
        const kept = previous.get(attendee.user.toString());
        if (kept) attendee.status = kept;
      }
      event.attendees = attendees;
      delete body.inviteeIds;
    }
    for (const key of ['title', 'description', 'location', 'meetingLink', 'reminderMinutes', 'timezone']) {
      if (body[key] !== undefined) event[key] = body[key];
    }
    if (body.startAt) event.startAt = body.startAt;
    if (body.endAt) event.endAt = body.endAt;
    // Times changed -> previously fired reminders may need to fire again.
    if (body.startAt || body.endAt || body.reminderMinutes) {
      event.remindersSent = [];
      event.markModified('remindersSent');
    }
    await event.save();
    await event.populate('attendees.user', 'username profilePicture');
    return res.json({ event: serialize(event) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the event creator can delete this event' });
    }
    await event.deleteOne();
    return res.json({ message: 'Event deleted' });
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/:id/respond',
  validate(z.object({ status: z.enum(['accepted', 'declined']) })),
  async (req, res, next) => {
    try {
      const event = await Event.findById(req.params.id);
      if (!event) return res.status(404).json({ message: 'Event not found' });
      const attendee = (event.attendees || []).find(
        (a) => a.user.toString() === req.user._id.toString()
      );
      if (!attendee) return res.status(403).json({ message: 'You are not invited to this event' });
      attendee.status = req.body.status;
      await event.save();
      await event.populate('attendees.user', 'username profilePicture');
      return res.json({ event: serialize(event) });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
