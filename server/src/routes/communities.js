const express = require('express');
const { z } = require('zod');
const Community = require('../models/Community');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Message = require('../models/Message');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireMembership } = require('../services/messageService');
const { addMembers } = require('./conversations');

const router = express.Router();
router.use(requireAuth);

function isCommunityAdmin(community, userId) {
  return (
    community.createdBy.toString() === userId.toString() ||
    (community.admins || []).some((a) => a.toString() === userId.toString())
  );
}

// Member list is derived from the linked groups (union of their
// participants) — never stored, so it can never drift out of sync.
async function deriveMembers(community) {
  const groups = await Conversation.find({ _id: { $in: community.groupIds } }).select(
    'participants'
  );
  const ids = new Set();
  for (const g of groups) {
    for (const p of g.participants || []) ids.add(p.toString());
  }
  if (community.announcementChannelId) {
    const channel = await Conversation.findById(community.announcementChannelId).select(
      'participants'
    );
    for (const p of (channel && channel.participants) || []) ids.add(p.toString());
  }
  return [...ids];
}

async function serializeCommunity(community, viewerId) {
  const obj = community.toObject ? community.toObject() : { ...community };
  const memberIds = await deriveMembers(community);
  obj.memberIds = memberIds;
  obj.memberCount = memberIds.length;
  obj.isAdmin = isCommunityAdmin(community, viewerId);
  obj.isMember = obj.isAdmin || memberIds.includes(viewerId.toString());
  const groups = await Conversation.find({ _id: { $in: community.groupIds } }).select(
    'groupName groupImage participants type'
  );
  obj.groups = groups.map((g) => ({
    _id: g._id,
    name: g.groupName,
    image: g.groupImage || '',
    memberCount: (g.participants || []).length,
  }));
  return obj;
}

// Validates a group the caller wants to link: must exist, be a group, and the
// caller must belong to it.
async function loadLinkableGroup(conversationId, userId) {
  const group = await Conversation.findById(conversationId);
  if (!group || group.type !== 'group') {
    const err = new Error('That conversation is not a group');
    err.status = 400;
    throw err;
  }
  await requireMembership(group._id, userId);
  return group;
}

// Adds a linked group's participants as followers of the announcement channel.
async function syncAnnouncementFollowers(community, group) {
  if (!community.announcementChannelId) return;
  const channel = await Conversation.findById(community.announcementChannelId);
  if (!channel) return;
  const existing = new Set(channel.participants.map((p) => p.toString()));
  const fresh = (group.participants || []).filter((p) => !existing.has(p.toString()));
  if (fresh.length) {
    channel.participants.push(...fresh);
    await channel.save();
    await addMembers(channel._id, fresh);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  avatar: z.string().optional(),
  groupIds: z.array(z.string()).max(20).optional(),
});

router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const me = req.user._id;
    const groupIds = [...new Set(req.body.groupIds || [])];
    const groups = [];
    for (const gid of groupIds) {
      groups.push(await loadLinkableGroup(gid, me));
    }
    // The announcement space is a channel (Module 14 mechanism): community
    // admins post, everyone else follows/reads.
    const channel = await Conversation.create({
      type: 'channel',
      participants: [me],
      groupName: `${req.body.name} — Announcements`,
      groupImage: req.body.avatar || '',
      description: `Announcements for ${req.body.name}`,
      visibility: 'public',
      admins: [me],
      createdBy: me,
    });
    await addMembers(channel._id, [me], [me]);

    const community = await Community.create({
      name: req.body.name,
      description: req.body.description || '',
      avatar: req.body.avatar || '',
      createdBy: me,
      admins: [me],
      groupIds,
      announcementChannelId: channel._id,
    });
    for (const group of groups) {
      await syncAnnouncementFollowers(community, group);
    }
    const populated = await Community.findById(community._id).populate(
      'createdBy',
      'username profilePicture'
    );
    return res.status(201).json({ community: await serializeCommunity(populated, me) });
  } catch (err) {
    return next(err);
  }
});

// Communities I created/admin, belong to via a linked group, or follow via
// the announcement channel.
router.get('/', async (req, res, next) => {
  try {
    const all = await Community.find()
      .sort({ updatedAt: -1 })
      .populate('createdBy', 'username profilePicture');
    const out = [];
    for (const community of all) {
      const s = await serializeCommunity(community, req.user._id);
      if (s.isMember) out.push(s);
    }
    return res.json({ communities: out });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const community = await Community.findById(req.params.id).populate(
      'createdBy',
      'username profilePicture'
    );
    if (!community) return res.status(404).json({ message: 'Community not found' });
    const s = await serializeCommunity(community, req.user._id);
    if (!s.isMember) return res.status(403).json({ message: 'You are not a member of this community' });
    const users = await User.find({ _id: { $in: s.memberIds } }).select(
      'username profilePicture status'
    );
    s.members = users;
    return res.json({ community: s });
  } catch (err) {
    return next(err);
  }
});

router.patch(
  '/:id',
  validate(
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().trim().max(500).optional(),
      avatar: z.string().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const community = await Community.findById(req.params.id);
      if (!community) return res.status(404).json({ message: 'Community not found' });
      if (!isCommunityAdmin(community, req.user._id)) {
        return res.status(403).json({ message: 'Only community admins can edit the community' });
      }
      if (req.body.name !== undefined) community.name = req.body.name;
      if (req.body.description !== undefined) community.description = req.body.description;
      if (req.body.avatar !== undefined) community.avatar = req.body.avatar;
      await community.save();
      return res.json({ community: await serializeCommunity(community, req.user._id) });
    } catch (err) {
      return next(err);
    }
  }
);

// Link an existing group into the community (community admins only; the
// admin must belong to the group). Its members become announcement followers.
router.post(
  '/:id/groups',
  validate(z.object({ conversationId: z.string() })),
  async (req, res, next) => {
    try {
      const community = await Community.findById(req.params.id);
      if (!community) return res.status(404).json({ message: 'Community not found' });
      if (!isCommunityAdmin(community, req.user._id)) {
        return res.status(403).json({ message: 'Only community admins can link groups' });
      }
      const group = await loadLinkableGroup(req.body.conversationId, req.user._id);
      if (!community.groupIds.some((g) => g.toString() === group._id.toString())) {
        community.groupIds.push(group._id);
        await community.save();
        await syncAnnouncementFollowers(community, group);
      }
      return res.json({ community: await serializeCommunity(community, req.user._id) });
    } catch (err) {
      return next(err);
    }
  }
);

router.delete('/:id/groups/:groupId', async (req, res, next) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: 'Community not found' });
    if (!isCommunityAdmin(community, req.user._id)) {
      return res.status(403).json({ message: 'Only community admins can unlink groups' });
    }
    community.groupIds = community.groupIds.filter(
      (g) => g.toString() !== req.params.groupId
    );
    await community.save();
    return res.json({ community: await serializeCommunity(community, req.user._id) });
  } catch (err) {
    return next(err);
  }
});

// Delete: creator only. Removes the announcement channel and its messages.
router.delete('/:id', async (req, res, next) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: 'Community not found' });
    if (community.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the community creator can delete it' });
    }
    if (community.announcementChannelId) {
      await Message.deleteMany({ conversationId: community.announcementChannelId });
      await ConversationMember.deleteMany({ conversationId: community.announcementChannelId });
      await Conversation.deleteOne({ _id: community.announcementChannelId });
    }
    await Community.deleteOne({ _id: community._id });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
