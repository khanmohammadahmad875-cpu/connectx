const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const Post = require('../models/Post');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const PAGE_SIZE = 10;
const COMMENTS_RETURNED = 50;

// The likes array itself is never sent: clients get a count + likedByMe
// (same contract as reels). Comments are populated and capped so a very
// long thread cannot bloat the feed payload.
function serializePost(post, viewerId) {
  const obj = post.toObject ? post.toObject() : { ...post };
  const likes = obj.likes || [];
  obj.likesCount = likes.length;
  obj.likedByMe = likes.some((id) => id.toString() === viewerId.toString());
  delete obj.likes;
  const comments = obj.comments || [];
  obj.commentsCount = comments.length;
  obj.comments = comments.slice(-COMMENTS_RETURNED);
  return obj;
}

const populated = (query) =>
  query
    .populate('author', 'username profilePicture')
    .populate('comments.user', 'username profilePicture');

const createSchema = z.object({
  text: z.string().max(2000).optional().default(''),
  imageUrl: z.string().max(2000).optional().default(''),
});

// Create a post. The photo must already have been uploaded through
// POST /api/uploads (image kind); a post needs text, a photo, or both.
router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const text = (req.body.text || '').trim();
    const imageUrl = (req.body.imageUrl || '').trim();
    if (!text && !imageUrl) {
      return res.status(400).json({ message: 'Write something or add a photo first.' });
    }
    const post = await Post.create({ author: req.user._id, text, imageUrl });
    const full = await populated(Post.findById(post._id));
    return res.status(201).json({ post: serializePost(full, req.user._id) });
  } catch (err) {
    return next(err);
  }
});

// Feed: every user's posts, newest first — like his reels, a post is
// visible to all signed-in users, not just contacts.
router.get('/feed', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const posts = await populated(Post.find({}))
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE + 1);
    const hasMore = posts.length > PAGE_SIZE;
    const pagePosts = hasMore ? posts.slice(0, PAGE_SIZE) : posts;
    return res.json({
      posts: pagePosts.map((p) => serializePost(p, req.user._id)),
      hasMore,
    });
  } catch (err) {
    return next(err);
  }
});

async function loadPost(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ message: 'Post not found' });
    return null;
  }
  const post = await Post.findById(req.params.id);
  if (!post) {
    res.status(404).json({ message: 'Post not found' });
    return null;
  }
  return post;
}

// Like / unlike (toggle).
router.post('/:id/like', async (req, res, next) => {
  try {
    const post = await loadPost(req, res);
    if (!post) return;
    const me = req.user._id.toString();
    const idx = post.likes.findIndex((id) => id.toString() === me);
    if (idx >= 0) post.likes.splice(idx, 1);
    else post.likes.push(req.user._id);
    await post.save();
    return res.json({
      likesCount: post.likes.length,
      likedByMe: idx < 0,
    });
  } catch (err) {
    return next(err);
  }
});

const commentSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

// Add a comment; returns the saved comment (populated) + the new count.
router.post('/:id/comments', validate(commentSchema), async (req, res, next) => {
  try {
    const post = await loadPost(req, res);
    if (!post) return;
    post.comments.push({ user: req.user._id, text: req.body.text });
    await post.save();
    const full = await populated(Post.findById(post._id));
    const serialized = serializePost(full, req.user._id);
    const comment = serialized.comments[serialized.comments.length - 1];
    return res.status(201).json({ comment, commentsCount: serialized.commentsCount });
  } catch (err) {
    return next(err);
  }
});

// Delete: only the author, or an admin (same rule as reel deletion).
router.delete('/:id', async (req, res, next) => {
  try {
    const post = await loadPost(req, res);
    if (!post) return;
    const mine = post.author.toString() === req.user._id.toString();
    if (!mine && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only delete your own posts' });
    }
    await post.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
