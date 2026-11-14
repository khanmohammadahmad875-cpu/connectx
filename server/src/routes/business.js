const express = require('express');
const { z } = require('zod');
const User = require('../models/User');
const BusinessProduct = require('../models/BusinessProduct');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  defaultHours,
  serializeOwnBusiness,
  serializePublicBusiness,
} = require('../services/businessService');

// Business profiles (v3.0 module 30): upgrade, edit, discovery, public
// pages, product catalogue CRUD and quick replies.
const router = express.Router();
router.use(requireAuth);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "Contacts" = users sharing at least one conversation (same rule as the
// contact cards); imported lazily to avoid a require cycle at load time.
async function isContact(ownerId, viewerId) {
  const ConversationMember = require('../models/ConversationMember');
  const mine = await ConversationMember.find({ userId: ownerId }).select('conversationId');
  if (!mine.length) return false;
  const hit = await ConversationMember.findOne({
    conversationId: { $in: mine.map((m) => m.conversationId) },
    userId: viewerId,
  }).select('_id');
  return !!hit;
}

// --- Own business profile -----------------------------------------------------

router.get('/me', (req, res) => {
  res.json({ business: serializeOwnBusiness(req.user) });
});

const hourEntry = z.object({
  day: z.number().int().min(0).max(6),
  open: z.string().regex(/^\d{2}:\d{2}$/, 'open must be HH:MM'),
  close: z.string().regex(/^\d{2}:\d{2}$/, 'close must be HH:MM'),
  closed: z.boolean().default(false),
});

const visibilityEnum = z.enum(['everyone', 'contacts', 'nobody']);

// NOTE: `verified` is deliberately absent from this schema — zod strips it,
// and the handler only assigns the whitelisted fields below. The badge is
// set exclusively by admins.
const businessPatchSchema = z.object({
  isBusiness: z.boolean().optional(),
  name: z.string().trim().max(120).optional(),
  logo: z.string().max(2000).optional(),
  cover: z.string().max(2000).optional(),
  category: z.string().trim().max(60).optional(),
  description: z.string().max(1000).optional(),
  publicEmail: z.string().max(120).optional(),
  publicPhone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  website: z.string().max(200).optional(),
  visibility: z
    .object({
      email: visibilityEnum.optional(),
      phone: visibilityEnum.optional(),
      address: visibilityEnum.optional(),
    })
    .optional(),
  hours: z.array(hourEntry).max(7).optional(),
  welcomeMessage: z.string().max(500).optional(),
  awayMessage: z.string().max(500).optional(),
  quickReplies: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(60),
        text: z.string().min(1).max(1000),
      })
    )
    .max(20)
    .optional(),
});

router.patch('/me', validate(businessPatchSchema), async (req, res, next) => {
  try {
    if (!req.user.business) req.user.business = {};
    const b = req.user.business;
    const body = req.body;
    for (const key of [
      'isBusiness',
      'name',
      'logo',
      'cover',
      'category',
      'description',
      'publicEmail',
      'publicPhone',
      'address',
      'website',
      'welcomeMessage',
      'awayMessage',
      'quickReplies',
    ]) {
      if (body[key] !== undefined) b[key] = body[key];
    }
    if (body.visibility) {
      if (!b.visibility) b.visibility = {};
      for (const f of ['email', 'phone', 'address']) {
        if (body.visibility[f] !== undefined) b.visibility[f] = body.visibility[f];
      }
    }
    if (body.hours !== undefined) {
      // Store a complete week: days the client omitted keep stored values,
      // and a first-time save starts from the default week.
      const base = b.hours && b.hours.length ? b.hours : defaultHours();
      const byDay = new Map(base.map((h) => [h.day, { day: h.day, open: h.open, close: h.close, closed: !!h.closed }]));
      for (const h of body.hours) byDay.set(h.day, h);
      b.hours = [...byDay.values()].sort((a, c) => a.day - c.day);
    }
    await req.user.save();
    return res.json({ business: serializeOwnBusiness(req.user) });
  } catch (err) {
    return next(err);
  }
});

// --- Quick replies --------------------------------------------------------------

router.get('/quick-replies', (req, res) => {
  const list = (req.user.business?.quickReplies || []).map((q) => ({
    title: q.title,
    text: q.text,
  }));
  res.json({ quickReplies: list });
});

router.put(
  '/quick-replies',
  validate(
    z.object({
      quickReplies: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(60),
            text: z.string().min(1).max(1000),
          })
        )
        .max(20),
    })
  ),
  async (req, res, next) => {
    try {
      if (!req.user.business) req.user.business = {};
      req.user.business.quickReplies = req.body.quickReplies;
      await req.user.save();
      return res.json({
        quickReplies: req.user.business.quickReplies.map((q) => ({ title: q.title, text: q.text })),
      });
    } catch (err) {
      return next(err);
    }
  }
);

// --- Products / services --------------------------------------------------------

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().default(''),
  price: z.number().min(0),
  currency: z.string().max(8).optional().default(''),
  image: z.string().max(2000).optional().default(''),
});

function serializeProduct(p) {
  return {
    _id: p._id,
    ownerId: p.ownerId,
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    image: p.image,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

router.get('/me/products', async (req, res, next) => {
  try {
    const products = await BusinessProduct.find({ ownerId: req.user._id }).sort({ createdAt: -1 });
    return res.json({ products: products.map(serializeProduct) });
  } catch (err) {
    return next(err);
  }
});

router.post('/products', validate(productSchema), async (req, res, next) => {
  try {
    if (!req.user.business?.isBusiness) {
      return res.status(400).json({ message: 'Enable your business profile before adding products' });
    }
    const product = await BusinessProduct.create({ ownerId: req.user._id, ...req.body });
    return res.status(201).json({ product: serializeProduct(product) });
  } catch (err) {
    return next(err);
  }
});

router.patch(
  '/products/:id',
  validate(productSchema.partial()),
  async (req, res, next) => {
    try {
      const product = await BusinessProduct.findById(req.params.id);
      if (!product) return res.status(404).json({ message: 'Product not found' });
      if (product.ownerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Only the business owner can edit this product' });
      }
      Object.assign(product, req.body);
      await product.save();
      return res.json({ product: serializeProduct(product) });
    } catch (err) {
      return next(err);
    }
  }
);

router.delete('/products/:id', async (req, res, next) => {
  try {
    const product = await BusinessProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (product.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the business owner can delete this product' });
    }
    await product.deleteOne();
    return res.json({ message: 'Product deleted' });
  } catch (err) {
    return next(err);
  }
});

// --- Discovery + public pages ---------------------------------------------------

router.get('/directory', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const category = (req.query.category || '').toString().trim();
    const filter = { 'business.isBusiness': true, isDeactivated: false };
    if (category) filter['business.category'] = { $regex: escapeRegex(category), $options: 'i' };
    if (q) {
      filter.$or = [
        { 'business.name': { $regex: escapeRegex(q), $options: 'i' } },
        { 'business.category': { $regex: escapeRegex(q), $options: 'i' } },
        { username: { $regex: escapeRegex(q), $options: 'i' } },
      ];
    }
    const users = await User.find(filter).limit(50);
    const businesses = [];
    for (const u of users) {
      const contact = await isContact(u._id, req.user._id);
      businesses.push(
        serializePublicBusiness(u, {
          isContact: contact || u._id.toString() === req.user._id.toString(),
          viewerTimeZone: (req.query.tz || '').toString(),
        })
      );
    }
    return res.json({ businesses });
  } catch (err) {
    return next(err);
  }
});

router.get('/:userId/products', async (req, res, next) => {
  try {
    const owner = await User.findById(req.params.userId);
    if (!owner || owner.isDeactivated || !owner.business?.isBusiness) {
      return res.status(404).json({ message: 'Business not found' });
    }
    const products = await BusinessProduct.find({ ownerId: owner._id }).sort({ createdAt: -1 });
    return res.json({ products: products.map(serializeProduct) });
  } catch (err) {
    return next(err);
  }
});

router.get('/:userId', async (req, res, next) => {
  try {
    const owner = await User.findById(req.params.userId);
    if (!owner || owner.isDeactivated || !owner.business?.isBusiness) {
      return res.status(404).json({ message: 'Business not found' });
    }
    const isSelf = owner._id.toString() === req.user._id.toString();
    const contact = isSelf ? true : await isContact(owner._id, req.user._id);
    const business = serializePublicBusiness(owner, {
      isContact: contact,
      viewerTimeZone: (req.query.tz || '').toString(),
    });
    const products = await BusinessProduct.find({ ownerId: owner._id }).sort({ createdAt: -1 });
    return res.json({ business, products: products.map(serializeProduct) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
