const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// --- v3.0 Phase A sub-schemas ------------------------------------------------

const convWallpaperSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true },
    wallpaper: { type: String, default: 'default' },
    customWallpaperUrl: { type: String, default: '' },
    dim: { type: Number, default: 45, min: 0, max: 85 },
  },
  { _id: false }
);

const weatherCitySchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    country: { type: String, default: '' },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false }
);

const clockCitySchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    timeZone: { type: String, required: true },
  },
  { _id: false }
);

// Contact-card visibility levels. homeAddress deliberately has a shorter enum:
// it may never be "everyone" (enforced again in the routes).
const VIS_EVERYONE = ['everyone', 'contacts', 'nobody'];
const VIS_PRIVATE = ['contacts', 'nobody'];

// --- v3.0 Phase C sub-schemas (business profiles, module 30) -----------------

// One day's working hours. open/close are "HH:MM" 24h strings in the
// business's own time zone (the owner's shared `timezone`, else UTC).
// closed=true means closed all day; close <= open means overnight hours.
const businessHourSchema = new mongoose.Schema(
  {
    day: { type: Number, required: true, min: 0, max: 6 }, // 0 = Sunday
    open: { type: String, default: '09:00', maxlength: 5 },
    close: { type: String, default: '17:00', maxlength: 5 },
    closed: { type: Boolean, default: false },
  },
  { _id: false }
);

const quickReplySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 60 },
    text: { type: String, required: true, maxlength: 1000 },
  },
  { _id: false }
);

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    // Session metadata (module 22): each refresh token is one signed-in
    // session. `sessionId` is a stable, non-secret handle so the owner can
    // list and revoke individual sessions; it survives token rotation.
    sessionId: { type: String, default: '' },
    userAgent: { type: String, default: '', maxlength: 400 },
    ip: { type: String, default: '', maxlength: 64 },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, required: true, select: false },
    profilePicture: { type: String, default: '' },
    bio: { type: String, default: '', maxlength: 200 },
    status: { type: String, enum: ['online', 'offline'], default: 'offline' },
    lastSeen: { type: Date, default: null },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBlocked: { type: Boolean, default: false }, // suspended by an admin
    isDeactivated: { type: Boolean, default: false }, // deactivated by the user
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    privacy: {
      showLastSeen: { type: Boolean, default: true },
      showProfilePicture: { type: Boolean, default: true },
    },
    // Optional IANA time zone the user chose to share (world clock, module 27).
    // Empty string = not shared; chat headers only show it when set.
    timezone: { type: String, default: '', maxlength: 64 },
    // Appearance + widget preferences (modules 25–27). Persisted server-side
    // so they follow the user across devices.
    preferences: {
      wallpaper: { type: String, default: 'default' },
      customWallpaperUrl: { type: String, default: '' },
      wallpaperDim: { type: Number, default: 45, min: 0, max: 85 },
      accentColor: { type: String, default: '#2f7bff' },
      conversationWallpapers: { type: [convWallpaperSchema], default: [] },
      weatherCities: { type: [weatherCitySchema], default: [] },
      clockCities: { type: [clockCitySchema], default: [] },
      clockFormat24h: { type: Boolean, default: false },
      // UI theme (WhatsApp-style polish): 'light' is the product default;
      // 'system' follows the device setting on the client.
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
      // Ambient live-weather background behind the app shell / dashboard.
      liveWeatherBackground: { type: Boolean, default: true },
      // Accessibility: chat text size + decorative animations master switch.
      fontSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
      animationsEnabled: { type: Boolean, default: true },
      // Notifications: show message previews in the notifications list, and
      // play the in-app alert sound for new messages.
      notificationPreviews: { type: Boolean, default: true },
      soundAlerts: { type: Boolean, default: true },
      // Default disappearing-message timer applied to conversations this
      // user creates (seconds; 0 = off).
      defaultDisappearingDuration: { type: Number, default: 0 },
    },
    // Contact card / address book (module 28). Field values live here; who may
    // see each field is governed by contactVisibility and enforced by the API.
    contactCard: {
      phone: { type: String, default: '', maxlength: 40 },
      whatsappNumber: { type: String, default: '', maxlength: 40 },
      country: { type: String, default: '', maxlength: 80 },
      city: { type: String, default: '', maxlength: 80 },
      homeAddress: { type: String, default: '', maxlength: 300 },
      businessAddress: { type: String, default: '', maxlength: 300 },
      postalCode: { type: String, default: '', maxlength: 20 },
      website: { type: String, default: '', maxlength: 200 },
      linkedin: { type: String, default: '', maxlength: 200 },
      github: { type: String, default: '', maxlength: 200 },
      jobTitle: { type: String, default: '', maxlength: 120 },
      organization: { type: String, default: '', maxlength: 120 },
    },
    contactVisibility: {
      phone: { type: String, enum: VIS_EVERYONE, default: 'nobody' },
      whatsappNumber: { type: String, enum: VIS_EVERYONE, default: 'nobody' },
      country: { type: String, enum: VIS_EVERYONE, default: 'contacts' },
      city: { type: String, enum: VIS_EVERYONE, default: 'contacts' },
      homeAddress: { type: String, enum: VIS_PRIVATE, default: 'nobody' },
      businessAddress: { type: String, enum: VIS_EVERYONE, default: 'nobody' },
      postalCode: { type: String, enum: VIS_EVERYONE, default: 'nobody' },
      website: { type: String, enum: VIS_EVERYONE, default: 'contacts' },
      linkedin: { type: String, enum: VIS_EVERYONE, default: 'contacts' },
      github: { type: String, enum: VIS_EVERYONE, default: 'contacts' },
      jobTitle: { type: String, enum: VIS_EVERYONE, default: 'contacts' },
      organization: { type: String, enum: VIS_EVERYONE, default: 'contacts' },
    },
    // Business profile (v3.0 module 30). Any user may upgrade; the public
    // page shows the fields below (contact fields honour `visibility`).
    // `verified` is deliberately NOT owner-writable: only an admin may set
    // it (PATCH /api/admin/users/:id/business-verified).
    business: {
      isBusiness: { type: Boolean, default: false },
      name: { type: String, default: '', maxlength: 120 },
      logo: { type: String, default: '' },
      cover: { type: String, default: '' },
      category: { type: String, default: '', maxlength: 60 },
      description: { type: String, default: '', maxlength: 1000 },
      publicEmail: { type: String, default: '', maxlength: 120 },
      publicPhone: { type: String, default: '', maxlength: 40 },
      address: { type: String, default: '', maxlength: 300 },
      website: { type: String, default: '', maxlength: 200 },
      visibility: {
        email: { type: String, enum: VIS_EVERYONE, default: 'everyone' },
        phone: { type: String, enum: VIS_EVERYONE, default: 'everyone' },
        address: { type: String, enum: VIS_EVERYONE, default: 'everyone' },
      },
      hours: { type: [businessHourSchema], default: [] },
      welcomeMessage: { type: String, default: '', maxlength: 500 },
      awayMessage: { type: String, default: '', maxlength: 500 },
      verified: { type: Boolean, default: false },
      quickReplies: { type: [quickReplySchema], default: [] },
    },
    refreshTokens: { type: [refreshTokenSchema], select: false },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    // Chat lock (Module 19) + hidden chats (Module 21). The lock PIN and the
    // secret code are stored ONLY as bcrypt hashes (select: false) and are
    // never returned by the API. Failed-attempt counters implement the
    // rate limit: after MAX_LOCK_ATTEMPTS failures the user is locked out
    // until the *LockedUntil timestamp passes.
    chatLockPinHash: { type: String, select: false, default: null },
    pinFailCount: { type: Number, default: 0 },
    pinLockedUntil: { type: Date, default: null },
    secretCodeHash: { type: String, select: false, default: null },
    secretFailCount: { type: Number, default: 0 },
    secretLockedUntil: { type: Date, default: null },
    // Two-factor authentication (module 22). The TOTP secret is stored only
    // AES-256-GCM encrypted (select: false) and is never returned by any API
    // after setup. Backup codes are stored only as bcrypt hashes
    // (select: false); each is usable exactly once. Failed code attempts are
    // rate-limited with the same counter/lockout pattern as the chat PIN.
    totpEnabled: { type: Boolean, default: false },
    totpSecretEncrypted: { type: String, select: false, default: null },
    totpBackupCodeHashes: { type: [String], select: false, default: [] },
    totpFailCount: { type: Number, default: 0 },
    totpLockedUntil: { type: Date, default: null },
    // Anti-spam (module 24): set automatically when an account accumulates
    // enough reports from distinct users (see routes/reports.js). Admins
    // see the flag in the admin panel and decide what to do — the system
    // never auto-bans.
    spamFlagged: { type: Boolean, default: false },
    spamFlagReason: { type: String, default: '', maxlength: 300 },
    spamFlaggedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
};

// Never leak secrets in API responses.
userSchema.methods.toSafeJSON = function toSafeJSON() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokens;
  delete obj.resetPasswordTokenHash;
  delete obj.resetPasswordExpires;
  delete obj.chatLockPinHash;
  delete obj.secretCodeHash;
  delete obj.totpSecretEncrypted;
  delete obj.totpBackupCodeHashes;
  delete obj.totpFailCount;
  delete obj.totpLockedUntil;
  delete obj.pinFailCount;
  delete obj.pinLockedUntil;
  delete obj.secretFailCount;
  delete obj.secretLockedUntil;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
