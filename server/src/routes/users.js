const express = require('express');
const { z } = require('zod');
const User = require('../models/User');
const ConversationMember = require('../models/ConversationMember');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

function publicProfile(user, viewer) {
  const obj = user.toSafeJSON ? user.toSafeJSON() : { ...user };
  delete obj.blockedUsers;
  delete obj.email;
  // Contact-card data and personal preferences are never part of a public
  // profile — they are served only by their own permission-checked endpoints.
  delete obj.contactCard;
  delete obj.contactVisibility;
  delete obj.preferences;
  // Business settings (welcome/away texts, quick replies, visibility map)
  // stay private too; a public profile only carries the badge summary —
  // the full public page lives at GET /api/business/:userId.
  const biz = user.business || {};
  delete obj.business;
  obj.businessSummary = biz.isBusiness
    ? { isBusiness: true, verified: !!biz.verified, name: biz.name || '', category: biz.category || '' }
    : { isBusiness: false, verified: false, name: '', category: '' };
  if (!user.privacy?.showLastSeen) {
    obj.lastSeen = null;
    obj.status = 'offline';
  }
  if (!user.privacy?.showProfilePicture) obj.profilePicture = '';
  obj.isOnline = user.status === 'online' && !!user.privacy?.showLastSeen;
  if (viewer) obj.blockedByMe = (viewer.blockedUsers || []).some((id) => id.toString() === user._id.toString());
  return obj;
}

// --- Preferences (v3.0 Phase A: wallpapers, weather, world clock) ------------

function serializePreferences(user) {
  const p = user.preferences || {};
  return {
    wallpaper: p.wallpaper ?? 'default',
    customWallpaperUrl: p.customWallpaperUrl ?? '',
    wallpaperDim: p.wallpaperDim ?? 45,
    accentColor: p.accentColor ?? '#2f7bff',
    conversationWallpapers: (p.conversationWallpapers || []).map((c) => ({
      conversationId: c.conversationId,
      wallpaper: c.wallpaper ?? 'default',
      customWallpaperUrl: c.customWallpaperUrl ?? '',
      dim: c.dim ?? 45,
    })),
    weatherCities: (p.weatherCities || []).map((c) => ({
      name: c.name ?? '',
      country: c.country ?? '',
      latitude: c.latitude,
      longitude: c.longitude,
    })),
    clockCities: (p.clockCities || []).map((c) => ({
      label: c.label ?? '',
      timeZone: c.timeZone,
    })),
    clockFormat24h: p.clockFormat24h ?? false,
    theme: p.theme ?? 'light',
    liveWeatherBackground: p.liveWeatherBackground ?? true,
    fontSize: p.fontSize ?? 'medium',
    animationsEnabled: p.animationsEnabled ?? true,
    notificationPreviews: p.notificationPreviews ?? true,
    soundAlerts: p.soundAlerts ?? true,
    defaultDisappearingDuration: p.defaultDisappearingDuration ?? 0,
  };
}

router.get('/me/preferences', (req, res) => {
  res.json({ preferences: serializePreferences(req.user) });
});

const convWallpaperEntry = z.object({
  conversationId: z.string().min(1).max(64),
  wallpaper: z.string().max(40).default('default'),
  customWallpaperUrl: z.string().max(2000).default(''),
  dim: z.number().min(0).max(85).default(45),
});

const preferencesSchema = z.object({
  wallpaper: z.string().max(40).optional(),
  customWallpaperUrl: z.string().max(2000).optional(),
  wallpaperDim: z.number().min(0).max(85).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'accentColor must be a #rrggbb hex color')
    .optional(),
  conversationWallpapers: z.array(convWallpaperEntry).max(200).optional(),
  weatherCities: z
    .array(
      z.object({
        name: z.string().max(80).default(''),
        country: z.string().max(80).default(''),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
    )
    .max(20)
    .optional(),
  clockCities: z
    .array(
      z.object({
        label: z.string().max(80).default(''),
        timeZone: z.string().min(1).max(64),
      })
    )
    .max(20)
    .optional(),
  clockFormat24h: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  liveWeatherBackground: z.boolean().optional(),
  fontSize: z.enum(['small', 'medium', 'large']).optional(),
  animationsEnabled: z.boolean().optional(),
  notificationPreviews: z.boolean().optional(),
  soundAlerts: z.boolean().optional(),
  defaultDisappearingDuration: z.number().int().min(0).max(2592000).optional(),
});

router.patch('/me/preferences', validate(preferencesSchema), async (req, res, next) => {
  try {
    if (!req.user.preferences) req.user.preferences = {};
    for (const [key, value] of Object.entries(req.body)) {
      req.user.preferences[key] = value;
    }
    await req.user.save();
    return res.json({ preferences: serializePreferences(req.user) });
  } catch (err) {
    return next(err);
  }
});

// --- Contact cards / address book (v3.0 module 28) ---------------------------

const CONTACT_FIELDS = [
  'phone',
  'whatsappNumber',
  'country',
  'city',
  'homeAddress',
  'businessAddress',
  'postalCode',
  'website',
  'linkedin',
  'github',
  'jobTitle',
  'organization',
];

// "Contacts" = users who share at least one conversation with the owner.
async function sharesConversation(userA, userB) {
  const mine = await ConversationMember.find({ userId: userA }).select('conversationId');
  if (!mine.length) return false;
  const hit = await ConversationMember.findOne({
    conversationId: { $in: mine.map((m) => m.conversationId) },
    userId: userB,
  }).select('_id');
  return !!hit;
}

function serializeOwnContactCard(user) {
  const fields = {};
  const visibility = {};
  for (const f of CONTACT_FIELDS) {
    fields[f] = user.contactCard?.[f] ?? '';
    visibility[f] = user.contactVisibility?.[f] ?? (f === 'homeAddress' ? 'nobody' : 'nobody');
  }
  return { fields, visibility };
}

router.get('/me/contact-card', (req, res) => {
  res.json({ contactCard: serializeOwnContactCard(req.user) });
});

const visibilityEnum = z.enum(['everyone', 'contacts', 'nobody']);
const contactCardPatchSchema = z.object({
  fields: z
    .object({
      phone: z.string().max(40).optional(),
      whatsappNumber: z.string().max(40).optional(),
      country: z.string().max(80).optional(),
      city: z.string().max(80).optional(),
      homeAddress: z.string().max(300).optional(),
      businessAddress: z.string().max(300).optional(),
      postalCode: z.string().max(20).optional(),
      website: z.string().max(200).optional(),
      linkedin: z.string().max(200).optional(),
      github: z.string().max(200).optional(),
      jobTitle: z.string().max(120).optional(),
      organization: z.string().max(120).optional(),
    })
    .optional(),
  visibility: z
    .object({
      phone: visibilityEnum.optional(),
      whatsappNumber: visibilityEnum.optional(),
      country: visibilityEnum.optional(),
      city: visibilityEnum.optional(),
      // A home address may NEVER be public — "everyone" is not accepted here.
      homeAddress: z.enum(['contacts', 'nobody']).optional(),
      businessAddress: visibilityEnum.optional(),
      postalCode: visibilityEnum.optional(),
      website: visibilityEnum.optional(),
      linkedin: visibilityEnum.optional(),
      github: visibilityEnum.optional(),
      jobTitle: visibilityEnum.optional(),
      organization: visibilityEnum.optional(),
    })
    .optional(),
});

router.patch('/me/contact-card', validate(contactCardPatchSchema), async (req, res, next) => {
  try {
    const { fields, visibility } = req.body;
    if (fields) {
      if (!req.user.contactCard) req.user.contactCard = {};
      for (const f of CONTACT_FIELDS) {
        if (fields[f] !== undefined) req.user.contactCard[f] = fields[f].trim();
      }
    }
    if (visibility) {
      if (!req.user.contactVisibility) req.user.contactVisibility = {};
      for (const f of CONTACT_FIELDS) {
        if (visibility[f] === undefined) continue;
        // Defense in depth: even if validation changes, homeAddress can never
        // be stored as "everyone".
        if (f === 'homeAddress' && visibility[f] === 'everyone') {
          return res
            .status(400)
            .json({ message: 'homeAddress visibility cannot be "everyone"' });
        }
        req.user.contactVisibility[f] = visibility[f];
      }
    }
    await req.user.save();
    return res.json({ contactCard: serializeOwnContactCard(req.user) });
  } catch (err) {
    return next(err);
  }
});

// Privacy-filtered contact card for another user. The API — not the UI —
// decides what the requester may see:
//   everyone → any authenticated user; contacts → users sharing a
//   conversation with the owner; nobody → only the owner (via /me/contact-card).
router.get('/:id/contact-card', async (req, res, next) => {
  try {
    const owner = await User.findById(req.params.id);
    if (!owner || owner.isDeactivated) return res.status(404).json({ message: 'User not found' });
    const isSelf = owner._id.toString() === req.user._id.toString();
    const isContact = isSelf ? true : await sharesConversation(owner._id, req.user._id);

    const fields = {};
    for (const f of CONTACT_FIELDS) {
      const value = owner.contactCard?.[f];
      if (!value) continue;
      const vis = owner.contactVisibility?.[f] ?? 'nobody';
      if (isSelf || vis === 'everyone' || (vis === 'contacts' && isContact)) {
        fields[f] = value;
      }
    }
    const card = {
      userId: owner._id,
      username: owner.username,
      profilePicture: owner.privacy?.showProfilePicture ? owner.profilePicture : '',
      isContact,
      fields,
    };
    // Email is never public; people the owner actually chats with (and the
    // owner) get it so the mailto quick action can work.
    if (isSelf || isContact) card.email = owner.email;
    return res.json({ contactCard: card });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
});

const updateSchema = z.object({
  username: z.string().trim().min(2).max(40).optional(),
  bio: z.string().max(200).optional(),
  profilePicture: z.string().url().or(z.literal('')).optional(),
  // Optional shared IANA time zone (world clock). '' clears it (= not shared).
  timezone: z.string().max(64).optional(),
  privacy: z
    .object({
      showLastSeen: z.boolean().optional(),
      showProfilePicture: z.boolean().optional(),
    })
    .optional(),
});

router.patch('/me', validate(updateSchema), async (req, res, next) => {
  try {
    const { username, bio, profilePicture, privacy, timezone } = req.body;
    if (username !== undefined) req.user.username = username;
    if (bio !== undefined) req.user.bio = bio;
    if (profilePicture !== undefined) req.user.profilePicture = profilePicture;
    if (timezone !== undefined) {
      // Reject nonsense zones early; Intl throws for unknown IANA names.
      if (timezone !== '') {
        try {
          Intl.DateTimeFormat('en-US', { timeZone: timezone });
        } catch (e) {
          return res.status(400).json({ message: 'Unknown time zone' });
        }
      }
      req.user.timezone = timezone;
    }
    if (privacy) req.user.privacy = { ...req.user.privacy.toObject(), ...privacy };
    await req.user.save();
    return res.json({ user: req.user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (q.length < 1) return res.json({ users: [] });
    const blockedIds = (req.user.blockedUsers || []).map((id) => id.toString());
    const users = await User.find({
      _id: { $ne: req.user._id },
      isDeactivated: false,
      $or: [
        { username: { $regex: escapeRegex(q), $options: 'i' } },
        { email: { $regex: escapeRegex(q), $options: 'i' } },
      ],
    }).limit(20);
    const visible = users.filter((u) => !blockedIds.includes(u._id.toString()));
    return res.json({ users: visible.map((u) => publicProfile(u, req.user)) });
  } catch (err) {
    return next(err);
  }
});

router.get('/me/blocks', async (req, res, next) => {
  try {
    const me = await User.findById(req.user._id).populate('blockedUsers', 'username profilePicture');
    return res.json({ blocked: me.blockedUsers.map((u) => publicProfile(u)) });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/block', async (req, res, next) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot block yourself' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (!req.user.blockedUsers.some((id) => id.toString() === target._id.toString())) {
      req.user.blockedUsers.push(target._id);
      await req.user.save();
    }
    return res.json({ message: 'User blocked' });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/unblock', async (req, res, next) => {
  try {
    req.user.blockedUsers = (req.user.blockedUsers || []).filter(
      (id) => id.toString() !== req.params.id
    );
    await req.user.save();
    return res.json({ message: 'User unblocked' });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.isDeactivated) return res.status(404).json({ message: 'User not found' });
    return res.json({ user: publicProfile(user, req.user) });
  } catch (err) {
    return next(err);
  }
});

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Data export & import (module 23: backup & recovery) ---------------------
//
// EXPORT — GET /api/users/me/export downloads everything that belongs to
// the caller as one JSON document: profile, contact card, preferences,
// business settings, conversation metadata, the caller's messages, events,
// documents data (folders/files/notes/tasks) and call history.
//
// EXPLICIT EXCLUSIONS — the export NEVER contains:
//   - the password hash, the chat-lock PIN hash or the secret-code hash;
//   - refresh tokens / session data of any kind;
//   - the TOTP secret (encrypted or not) or backup-code hashes;
//   - the password-reset token hash;
//   - anyone else's private data (other users appear only as ids and, in
//     messages they sent inside shared conversations, their own message
//     content that the caller could already read);
//   - messages deleted for everyone (content and the record itself);
//   - messages the caller hid with "delete for me".
//
// IMPORT — POST /api/users/me/import restores the profile-level parts of
// such an export: preferences, contact card and documents data (folders,
// notes, task lists, tasks) plus events. The merge never deletes existing
// data; items that already exist are skipped and counted. Messages are
// deliberately NOT restorable — import must never fake chat history — and
// neither are calls or statuses.

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Call = require('../models/Call');
const Event = require('../models/Event');
const DocFolder = require('../models/DocFolder');
const DocFile = require('../models/DocFile');
const DocNote = require('../models/DocNote');
const TaskList = require('../models/TaskList');
const DocTask = require('../models/DocTask');

async function buildExport(user) {
  const memberships = await ConversationMember.find({ userId: user._id }).select('conversationId');
  const conversationIds = memberships.map((m) => m.conversationId);

  const [conversations, messages, events, calls, folders] = await Promise.all([
    Conversation.find({ _id: { $in: conversationIds } }).lean(),
    Message.find({
      conversationId: { $in: conversationIds },
      deletedAt: null,
      hiddenFor: { $ne: user._id },
    })
      .sort({ createdAt: 1 })
      .limit(10000)
      .lean(),
    Event.find({ $or: [{ creator: user._id }, { 'attendees.user': user._id }] })
      .select('-remindersSent')
      .lean(),
    Call.find({ $or: [{ callerId: user._id }, { calleeId: user._id }] }).lean(),
    DocFolder.find({ owner: user._id }).lean(),
  ]);

  const folderExports = [];
  for (const folder of folders) {
    const [files, notes, lists] = await Promise.all([
      DocFile.find({ folder: folder._id }).lean(),
      DocNote.find({ folder: folder._id }).lean(),
      TaskList.find({ folder: folder._id, owner: user._id }).lean(),
    ]);
    const listExports = [];
    for (const list of lists) {
      const tasks = await DocTask.find({ list: list._id }).lean();
      listExports.push({
        title: list.title,
        tasks: tasks.map((t) => ({
          title: t.title,
          description: t.description,
          status: t.status,
          dueDate: t.dueDate,
        })),
      });
    }
    folderExports.push({
      name: folder.name,
      files: files.map((f) => ({ name: f.name, url: f.url, size: f.size, mimeType: f.mimeType })),
      notes: notes.map((n) => ({ title: n.title, content: n.content })),
      taskLists: listExports,
    });
  }
  // Standalone task lists owned by the user (not inside a folder).
  const standaloneLists = await TaskList.find({ owner: user._id, folder: null }).lean();
  const standaloneExports = [];
  for (const list of standaloneLists) {
    const tasks = await DocTask.find({ list: list._id }).lean();
    standaloneExports.push({
      title: list.title,
      tasks: tasks.map((t) => ({
        title: t.title,
        description: t.description,
        status: t.status,
        dueDate: t.dueDate,
      })),
    });
  }

  const safeUser = user.toSafeJSON();
  return {
    app: 'ConnectX',
    kind: 'connectx-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: {
      username: safeUser.username,
      email: safeUser.email,
      bio: safeUser.bio,
      profilePicture: safeUser.profilePicture,
      timezone: safeUser.timezone,
      privacy: safeUser.privacy,
      createdAt: safeUser.createdAt,
    },
    contactCard: safeUser.contactCard,
    contactVisibility: safeUser.contactVisibility,
    preferences: serializePreferences(user),
    business: safeUser.business,
    conversations: conversations.map((c) => ({
      _id: c._id,
      type: c.type,
      participants: c.participants,
      groupName: c.groupName,
      description: c.description,
      createdAt: c.createdAt,
    })),
    messages: messages.map((m) => ({
      _id: m._id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      content: m.content,
      messageType: m.messageType,
      attachmentUrl: m.attachmentUrl,
      createdAt: m.createdAt,
    })),
    events: events.map((e) => ({
      title: e.title,
      description: e.description,
      startAt: e.startAt,
      endAt: e.endAt,
      timezone: e.timezone,
      location: e.location,
      meetingLink: e.meetingLink,
      reminderMinutes: e.reminderMinutes,
      creator: e.creator,
      attendees: (e.attendees || []).map((a) => ({ user: a.user, status: a.status })),
    })),
    calls: calls.map((c) => ({
      callerId: c.callerId,
      calleeId: c.calleeId,
      conversationId: c.conversationId,
      type: c.type,
      status: c.status,
      durationSec: c.durationSec,
      createdAt: c.createdAt,
    })),
    folders: folderExports,
    taskLists: standaloneExports,
  };
}

router.get('/me/export', async (req, res, next) => {
  try {
    const data = await buildExport(req.user);
    const filename = `connectx-export-${req.user.username}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    return next(err);
  }
});

router.post('/me/import', express.json({ limit: '5mb' }), async (req, res, next) => {
  try {
    const data = req.body && req.body.export ? req.body.export : req.body;
    if (!data || typeof data !== 'object' || data.kind !== 'connectx-export') {
      return res.status(400).json({ message: 'This does not look like a ConnectX export file' });
    }
    const summary = {
      imported: { folders: 0, notes: 0, taskLists: 0, tasks: 0, events: 0 },
      skipped: 0,
      preferencesRestored: false,
      contactCardRestored: false,
      messagesRestored: 0, // always 0 by design — see the note above
    };
    const user = req.user;

    // Preferences: merge the keys the export carries (never wipe others).
    if (data.preferences && typeof data.preferences === 'object') {
      if (!user.preferences) user.preferences = {};
      for (const key of ['wallpaper', 'customWallpaperUrl', 'wallpaperDim', 'accentColor', 'clockFormat24h', 'theme', 'liveWeatherBackground', 'fontSize', 'animationsEnabled', 'notificationPreviews', 'soundAlerts', 'defaultDisappearingDuration']) {
        if (data.preferences[key] !== undefined) user.preferences[key] = data.preferences[key];
      }
      for (const key of ['conversationWallpapers', 'weatherCities', 'clockCities']) {
        if (Array.isArray(data.preferences[key]) && data.preferences[key].length) {
          user.preferences[key] = data.preferences[key];
        }
      }
      summary.preferencesRestored = true;
    }

    // Contact card + visibility: restore field by field, skipping junk.
    if (data.contactCard && typeof data.contactCard === 'object') {
      for (const field of CONTACT_FIELDS) {
        if (typeof data.contactCard[field] === 'string') {
          user.contactCard[field] = data.contactCard[field].slice(0, 300);
        }
        const vis = data.contactVisibility && data.contactVisibility[field];
        const allowed = field === 'homeAddress' ? VIS_PRIVATE_VALUES : VIS_EVERYONE_VALUES;
        if (vis && allowed.includes(vis)) user.contactVisibility[field] = vis;
      }
      summary.contactCardRestored = true;
    }
    await user.save();

    async function importTaskList(ownerId, folderId, listData) {
      const existing = await TaskList.findOne({ owner: ownerId, folder: folderId, title: listData.title });
      if (existing) {
        summary.skipped += 1;
        return existing;
      }
      const list = await TaskList.create({ owner: ownerId, title: String(listData.title).slice(0, 200), folder: folderId });
      summary.imported.taskLists += 1;
      for (const taskData of listData.tasks || []) {
        if (!taskData || typeof taskData.title !== 'string' || !taskData.title.trim()) {
          summary.skipped += 1;
          continue;
        }
        const dupe = await DocTask.findOne({ list: list._id, title: taskData.title });
        if (dupe) {
          summary.skipped += 1;
          continue;
        }
        await DocTask.create({
          list: list._id,
          title: taskData.title.slice(0, 300),
          description: typeof taskData.description === 'string' ? taskData.description.slice(0, 2000) : '',
          status: ['todo', 'in-progress', 'done'].includes(taskData.status) ? taskData.status : 'todo',
          dueDate: taskData.dueDate && !Number.isNaN(new Date(taskData.dueDate).getTime()) ? new Date(taskData.dueDate) : null,
          assignee: null, // assignees are not restored — accounts may differ
          createdBy: ownerId,
        });
        summary.imported.tasks += 1;
      }
      return list;
    }

    // Folders (+ their notes, file records and task lists), deduped by name.
    for (const folderData of data.folders || []) {
      if (!folderData || typeof folderData.name !== 'string' || !folderData.name.trim()) {
        summary.skipped += 1;
        continue;
      }
      let folder = await DocFolder.findOne({ owner: user._id, name: folderData.name });
      if (!folder) {
        folder = await DocFolder.create({ owner: user._id, name: folderData.name.slice(0, 120) });
        summary.imported.folders += 1;
      }
      for (const noteData of folderData.notes || []) {
        if (!noteData || typeof noteData.title !== 'string' || !noteData.title.trim()) {
          summary.skipped += 1;
          continue;
        }
        const dupe = await DocNote.findOne({ folder: folder._id, title: noteData.title });
        if (dupe) {
          summary.skipped += 1;
          continue;
        }
        await DocNote.create({
          folder: folder._id,
          author: user._id,
          title: noteData.title.slice(0, 200),
          content: typeof noteData.content === 'string' ? noteData.content.slice(0, 20000) : '',
        });
        summary.imported.notes += 1;
      }
      for (const fileData of folderData.files || []) {
        if (!fileData || typeof fileData.url !== 'string' || !fileData.url) continue;
        const dupe = await DocFile.findOne({ folder: folder._id, url: fileData.url });
        if (dupe) {
          summary.skipped += 1;
          continue;
        }
        await DocFile.create({
          folder: folder._id,
          uploadedBy: user._id,
          name: String(fileData.name || 'file').slice(0, 200),
          url: fileData.url,
          size: Number(fileData.size) || 0,
          mimeType: String(fileData.mimeType || '').slice(0, 120),
        });
      }
      for (const listData of folderData.taskLists || []) {
        if (listData && typeof listData.title === 'string' && listData.title.trim()) {
          await importTaskList(user._id, folder._id, listData);
        } else {
          summary.skipped += 1;
        }
      }
    }

    // Standalone task lists.
    for (const listData of data.taskLists || []) {
      if (listData && typeof listData.title === 'string' && listData.title.trim()) {
        await importTaskList(user._id, null, listData);
      } else {
        summary.skipped += 1;
      }
    }

    // Events I created: deduped by title + start; invitees are kept only
    // when they are still this user's contacts — validateInvitees rules are
    // re-checked implicitly by only restoring my own events without
    // attendees beyond myself (attendees can be re-invited in the UI).
    for (const eventData of data.events || []) {
      if (
        !eventData ||
        typeof eventData.title !== 'string' ||
        !eventData.title.trim() ||
        String(eventData.creator) !== user._id.toString()
      ) {
        continue;
      }
      const startAt = new Date(eventData.startAt);
      const endAt = new Date(eventData.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        summary.skipped += 1;
        continue;
      }
      const dupe = await Event.findOne({ creator: user._id, title: eventData.title, startAt });
      if (dupe) {
        summary.skipped += 1;
        continue;
      }
      await Event.create({
        creator: user._id,
        title: eventData.title.slice(0, 200),
        description: typeof eventData.description === 'string' ? eventData.description.slice(0, 2000) : '',
        startAt,
        endAt,
        timezone: typeof eventData.timezone === 'string' ? eventData.timezone.slice(0, 64) : 'UTC',
        location: typeof eventData.location === 'string' ? eventData.location.slice(0, 300) : '',
        meetingLink: typeof eventData.meetingLink === 'string' ? eventData.meetingLink.slice(0, 500) : '',
        reminderMinutes: Array.isArray(eventData.reminderMinutes)
          ? eventData.reminderMinutes.filter((n) => Number.isInteger(n) && n >= 0 && n <= 10080).slice(0, 5)
          : [15],
        attendees: [],
      });
      summary.imported.events += 1;
    }

    return res.json({ summary });
  } catch (err) {
    return next(err);
  }
});

const VIS_EVERYONE_VALUES = ['everyone', 'contacts', 'nobody'];
const VIS_PRIVATE_VALUES = ['contacts', 'nobody'];

module.exports = router;
