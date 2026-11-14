const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, required: true, maxlength: 8 },
  },
  { _id: false }
);

// Poll state lives embedded in the message (Module: polls). Each option
// tracks the user ids who voted for it; percentages are derived from the
// vote counts, so the persisted state stays the single source of truth.
const pollOptionSchema = new mongoose.Schema({
  text: { type: String, required: true, maxlength: 200 },
  votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
});

const pollSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, maxlength: 300 },
    options: { type: [pollOptionSchema], default: [] },
    allowMultiple: { type: Boolean, default: false },
    closed: { type: Boolean, default: false },
  },
  { _id: false }
);

// Link analysis (module 24): every URL found in the text, its bare domain,
// and whether it was flagged (URL shortener or punycode host). Flagging is
// informational only — links are never blocked.
const linkFlagSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, maxlength: 2000 },
    domain: { type: String, default: '', maxlength: 300 },
    flagged: { type: Boolean, default: false },
    reasons: { type: [String], default: [] },
  },
  { _id: false }
);

// One-time location payload (module 29): a pin the sender dropped.
const locationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    label: { type: String, default: '', maxlength: 120 },
  },
  { _id: false }
);

// Live-location snapshot (module 29): latest known position + when sharing
// ends. The LiveLocationSession document is the source of truth; this
// snapshot lets history render without an extra lookup.
const liveLocationSnapshotSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveLocationSession', required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    label: { type: String, default: '', maxlength: 120 },
    expiresAt: { type: Date, required: true },
    stoppedAt: { type: Date, default: null },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, default: '', maxlength: 4000 },
    messageType: {
      type: String,
      enum: ['text', 'image', 'file', 'audio', 'video', 'poll', 'call', 'system', 'location', 'live_location'],
      default: 'text',
    },
    // Call system messages (module 8) point at their Call record; only the
    // server creates them, clients can never forge one through the API.
    callRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Call', default: null },
    // Location messages (module 29).
    location: { type: locationSchema, default: undefined },
    liveLocation: { type: liveLocationSnapshotSchema, default: undefined },
    // Business auto-messages (module 30): 'welcome' | 'away'. Set only by
    // the server when it auto-sends on behalf of a business; the marker is
    // what guarantees auto-replies can never trigger further auto-replies.
    autoReply: { type: String, enum: ['welcome', 'away'], default: undefined },
    attachmentUrl: { type: String, default: '' },
    // Voice message metadata (Module 5): duration in seconds plus a compact
    // waveform (peak amplitudes 0..1) computed in the browser at record time.
    audioMeta: {
      duration: { type: Number, default: 0 },
      waveform: { type: [Number], default: [] },
    },
    // Video message metadata: duration in seconds (measured client-side),
    // file size in bytes and the MIME type, all captured at send time.
    videoMeta: {
      duration: { type: Number, default: 0 },
      size: { type: Number, default: 0 },
      mime: { type: String, default: '' },
    },
    // Disappearing messages: when set, the message is filtered out of every
    // read once this passes, and a TTL index removes the document itself.
    // Null for ordinary messages (TTL ignores nulls).
    expiresAt: { type: Date, default: null },
    // Embedded poll state (only set when messageType === 'poll').
    poll: { type: pollSchema, default: undefined },
    // Link safety analysis of `content` (module 24), computed server-side
    // at send time by utils/linkSafety.js.
    linkFlags: { type: [linkFlagSchema], default: [] },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    reactions: { type: [reactionSchema], default: [] },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // "Delete for me": users in this list no longer see the message, while it
    // stays visible to everyone else (per-user hide, no global delete).
    hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Client-generated ID that makes sending idempotent: a retried send with the
    // same clientMessageId returns the existing message instead of a duplicate.
    clientMessageId: { type: String, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
// TTL cleanup for disappearing messages (same approach as Status): MongoDB
// deletes the document once expiresAt passes; reads filter lazily as well,
// so expiry is exact even before the TTL monitor runs.
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
messageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Message', messageSchema);
