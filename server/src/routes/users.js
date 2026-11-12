const express = require('express');
const { z } = require('zod');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

function publicProfile(user, viewer) {
  const obj = user.toSafeJSON ? user.toSafeJSON() : { ...user };
  delete obj.blockedUsers;
  delete obj.email;
  if (!user.privacy?.showLastSeen) {
    obj.lastSeen = null;
    obj.status = 'offline';
  }
  if (!user.privacy?.showProfilePicture) obj.profilePicture = '';
  obj.isOnline = user.status === 'online' && !!user.privacy?.showLastSeen;
  if (viewer) obj.blockedByMe = (viewer.blockedUsers || []).some((id) => id.toString() === user._id.toString());
  return obj;
}

router.get('/me', (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
});

const updateSchema = z.object({
  username: z.string().trim().min(2).max(40).optional(),
  bio: z.string().max(200).optional(),
  profilePicture: z.string().url().or(z.literal('')).optional(),
  privacy: z
    .object({
      showLastSeen: z.boolean().optional(),
      showProfilePicture: z.boolean().optional(),
    })
    .optional(),
});

router.patch('/me', validate(updateSchema), async (req, res, next) => {
  try {
    const { username, bio, profilePicture, privacy } = req.body;
    if (username !== undefined) req.user.username = username;
    if (bio !== undefined) req.user.bio = bio;
    if (profilePicture !== undefined) req.user.profilePicture = profilePicture;
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

module.exports = router;
