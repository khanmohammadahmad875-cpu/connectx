const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const Reel = require('../models/Reel');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { REEL_INTERESTS } = require('../utils/interests');

const router = express.Router();
router.use(requireAuth);

const PAGE_SIZE = 8;

// The likes array itself is never sent: clients get a count + likedByMe.
function serializeReel(reel, viewerId) {
  const obj = reel.toObject ? reel.toObject() : { ...reel };
  const likes = obj.likes || [];
  obj.likesCount = likes.length;
  obj.likedByMe = likes.some((id) => id.toString() === viewerId.toString());
  delete obj.likes;
  delete obj.tier; // aggregation artefact on feed results
  return obj;
}

const createSchema = z.object({
  videoUrl: z.string().min(1).max(2000),
  caption: z.string().max(500).optional().default(''),
  interest: z
    .string()
    .refine((v) => REEL_INTERESTS.includes(v), { message: 'Unknown interest' }),
});

// Create a reel. The video itself must already have been uploaded through
// POST /api/uploads (video kind, same caps as chat/status videos).
router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const reel = await Reel.create({
      author: req.user._id,
      videoUrl: req.body.videoUrl,
      caption: (req.body.caption || '').trim(),
      interest: req.body.interest,
    });
    const populated = await Reel.findById(reel._id).populate('author', 'username profilePicture');
    return res.status(201).json({ reel: serializeReel(populated, req.user._id) });
  } catch (err) {
    return next(err);
  }
});

// Feed: two tiers — reels whose interest matches the caller's reelInterests
// first, then everything else; newest first inside each tier. Cursor
// pagination over that ordering (the cursor carries tier + createdAt + _id
// of the last item of the previous page), page size 8.
router.get('/feed', async (req, res, next) => {
  try {
    const interests = Array.isArray(req.user.preferences?.reelInterests)
      ? req.user.preferences.reelInterests
      : [];

    let cursor = null;
    if (req.query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(String(req.query.cursor), 'base64url').toString('utf8'));
      } catch (err) {
        cursor = null; // a broken cursor just starts from the top
      }
    }

    const pipeline = [
      { $addFields: { tier: { $cond: [{ $in: ['$interest', interests] }, 0, 1] } } },
    ];
    if (
      cursor &&
      typeof cursor.tier === 'number' &&
      cursor.createdAt &&
      mongoose.Types.ObjectId.isValid(cursor.id || '')
    ) {
      const cDate = new Date(cursor.createdAt);
      const cId = new mongoose.Types.ObjectId(cursor.id);
      pipeline.push({
        $match: {
          $or: [
            { tier: { $gt: cursor.tier } },
            { tier: cursor.tier, createdAt: { $lt: cDate } },
            { tier: cursor.tier, createdAt: cDate, _id: { $lt: cId } },
          ],
        },
      });
    }
    pipeline.push({ $sort: { tier: 1, createdAt: -1, _id: -1 } }, { $limit: PAGE_SIZE + 1 });

    const docs = await Reel.aggregate(pipeline);
    const hasMore = docs.length > PAGE_SIZE;
    const page = docs.slice(0, PAGE_SIZE);
    await Reel.populate(page, { path: 'author', select: 'username profilePicture' });

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({ tier: last.tier, createdAt: last.createdAt, id: String(last._id) })
          ).toString('base64url')
        : null;

    return res.json({ reels: page.map((r) => serializeReel(r, req.user._id)), nextCursor });
  } catch (err) {
    return next(err);
  }
});

// Toggle my like on a reel.
router.post('/:id/like', async (req, res, next) => {
  try {
    const reel = await Reel.findById(req.params.id);
    if (!reel) return res.status(404).json({ message: 'Reel not found' });
    const me = req.user._id;
    const idx = reel.likes.findIndex((id) => id.toString() === me.toString());
    if (idx >= 0) reel.likes.splice(idx, 1);
    else reel.likes.push(me);
    await reel.save();
    return res.json({ liked: idx < 0, likesCount: reel.likes.length });
  } catch (err) {
    return next(err);
  }
});

// Record a view (the client fires this when a reel becomes the visible one).
router.post('/:id/view', async (req, res, next) => {
  try {
    const reel = await Reel.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    ).select('views');
    if (!reel) return res.status(404).json({ message: 'Reel not found' });
    return res.json({ ok: true, views: reel.views });
  } catch (err) {
    return next(err);
  }
});

// Delete: the author, or an admin.
router.delete('/:id', async (req, res, next) => {
  try {
    const reel = await Reel.findById(req.params.id);
    if (!reel) return res.status(404).json({ message: 'Reel not found' });
    const mine = reel.author.toString() === req.user._id.toString();
    if (!mine && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only delete your own reels' });
    }
    await reel.deleteOne();
    return res.json({ message: 'Reel deleted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
