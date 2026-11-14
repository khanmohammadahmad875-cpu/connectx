const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { isOpenAt } = require('./businessService');
const { checkAndRecordSend } = require('./spamService');
const { analyzeLinks } = require('../utils/linkSafety');

async function requireMembership(conversationId, userId) {
  const member = await ConversationMember.findOne({ conversationId, userId });
  if (!member) {
    const err = new Error('You are not a member of this conversation');
    err.status = 403;
    throw err;
  }
  return member;
}

function populateMessage(query) {
  return query
    .populate('senderId', 'username profilePicture')
    .populate({
      path: 'replyTo',
      select: 'content senderId messageType deletedAt',
      populate: { path: 'senderId', select: 'username' },
    });
}

/**
 * Creates a message (shared by REST and Socket.IO).
 * Idempotent: when clientMessageId was already used by this sender, the
 * existing message is returned with duplicate=true and nothing is re-created.
 *
 * Server-side enforcement that lives here so REST and Socket.IO can never
 * diverge:
 *  - chat lock (Module 19): a locked conversation refuses sends unless the
 *    caller presents a valid unlock grant (`unlocked: true`).
 *  - channels (Module 14): only admins may post in a channel.
 *  - archive (Module 20): a new message auto-unarchives the conversation
 *    for every other member who archived it.
 */
function validCoords(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

async function createMessage({
  conversationId,
  senderId,
  content = '',
  messageType = 'text',
  attachmentUrl = '',
  replyTo = null,
  clientMessageId = null,
  audioMeta = null,
  videoMeta = null,
  poll = null,
  location = null,
  liveLocation = null,
  unlocked = false,
}) {
  const member = await requireMembership(conversationId, senderId);

  if (member.locked && !unlocked) {
    const err = new Error('This chat is locked. Unlock it to continue.');
    err.status = 423;
    throw err;
  }

  if (messageType === 'call') {
    // Call system messages are written by callService only — never clients.
    const err = new Error('Call messages are created by the server');
    err.status = 400;
    throw err;
  }

  if (messageType === 'system') {
    // System notices (e.g. disappearing-message changes) are written by the
    // server only — never clients.
    const err = new Error('System messages are created by the server');
    err.status = 400;
    throw err;
  }

  const conversation = await Conversation.findById(conversationId);
  if (conversation && conversation.type === 'channel' && member.role !== 'admin') {
    const err = new Error('Only channel admins can post in this channel');
    err.status = 403;
    throw err;
  }

  if (clientMessageId) {
    const existing = await Message.findOne({ senderId, clientMessageId });
    if (existing) {
      return {
        message: await populateMessage(Message.findById(existing._id)),
        duplicate: true,
        autoReplies: [],
      };
    }
  }

  if (messageType === 'text' && !content.trim() && !attachmentUrl) {
    const err = new Error('Message content is empty');
    err.status = 400;
    throw err;
  }

  // Poll payload validation (question + 2–10 non-empty options).
  let pollDoc;
  if (messageType === 'poll') {
    const question = (poll && poll.question ? String(poll.question) : '').trim();
    const options = ((poll && poll.options) || [])
      .map((o) => String(o || '').trim())
      .filter(Boolean);
    if (!question || options.length < 2 || options.length > 10) {
      const err = new Error('A poll needs a question and 2–10 options');
      err.status = 400;
      throw err;
    }
    pollDoc = {
      question,
      options: options.map((text) => ({ text, votes: [] })),
      allowMultiple: !!(poll && poll.allowMultiple),
      closed: false,
    };
  }

  // Location payloads (module 29): a one-time pin, or the live-location
  // snapshot written by liveLocationService when a session starts. 'call'
  // messages are server-only and never reach this path from clients.
  let locationDoc;
  if (messageType === 'location') {
    if (!location || !validCoords(Number(location.latitude), Number(location.longitude))) {
      const err = new Error('A location message needs valid latitude/longitude');
      err.status = 400;
      throw err;
    }
    locationDoc = {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      label: String(location.label || '').slice(0, 120),
    };
  }
  let liveLocationDoc;
  if (messageType === 'live_location') {
    if (
      !liveLocation ||
      !liveLocation.sessionId ||
      !validCoords(Number(liveLocation.latitude), Number(liveLocation.longitude)) ||
      !liveLocation.expiresAt
    ) {
      const err = new Error('A live location message needs a session, coordinates and an expiry');
      err.status = 400;
      throw err;
    }
    liveLocationDoc = {
      sessionId: liveLocation.sessionId,
      latitude: Number(liveLocation.latitude),
      longitude: Number(liveLocation.longitude),
      label: String(liveLocation.label || '').slice(0, 120),
      expiresAt: new Date(liveLocation.expiresAt),
    };
  }

  // Video metadata: duration (s), size (bytes) and MIME — clamped, all
  // optional. A video message without an uploaded file is meaningless.
  let videoDoc;
  if (messageType === 'video') {
    if (!attachmentUrl) {
      const err = new Error('A video message needs an uploaded video file');
      err.status = 400;
      throw err;
    }
    videoDoc = {
      duration: Math.max(0, Math.min(86400, Number(videoMeta && videoMeta.duration) || 0)),
      size: Math.max(0, Math.min(64 * 1024 * 1024, Number(videoMeta && videoMeta.size) || 0)),
      mime: String((videoMeta && videoMeta.mime) || '').slice(0, 100),
    };
  }

  // Voice metadata: duration in seconds + waveform peaks clamped to 0..1.
  let audioDoc;
  if (messageType === 'audio') {
    const waveform = Array.isArray(audioMeta && audioMeta.waveform)
      ? audioMeta.waveform
          .slice(0, 64)
          .map((v) => Math.min(1, Math.max(0, Number(v) || 0)))
      : [];
    audioDoc = {
      duration: Math.max(0, Math.min(3600, Number(audioMeta && audioMeta.duration) || 0)),
      waveform,
    };
  }

  // Anti-spam (module 24): volume + new-account distinct-recipient limits.
  // Runs after the idempotency check (a retried send is not a new send) and
  // before anything is persisted; a refusal throws 429. The sender document
  // is loaded because the new-account rule needs the account's age.
  const senderUser = await User.findById(senderId).select('createdAt');
  let distinctRecipientId = null;
  if (conversation && conversation.type === 'private') {
    distinctRecipientId =
      (conversation.participants || [])
        .map((p) => p.toString())
        .find((id) => id !== senderId.toString()) || null;
  }
  checkAndRecordSend({ sender: senderUser || { _id: senderId }, distinctRecipientId });

  // Link safety (module 24): analyse URLs in the text; flagged links are
  // stored with the message so clients can show the domain + a warning.
  const linkFlags = messageType === 'text' || messageType === 'image' || messageType === 'file'
    ? analyzeLinks(content)
    : [];

  // Disappearing messages: stamp the expiry from the conversation's timer.
  // System/call notices are written directly with Message.create elsewhere
  // and never expire.
  const disappearingSec =
    conversation && Number(conversation.disappearingDurationSec) > 0
      ? Number(conversation.disappearingDurationSec)
      : 0;

  let message;
  try {
    message = await Message.create({
      conversationId,
      senderId,
      content: content.trim(),
      messageType,
      attachmentUrl,
      replyTo: replyTo || null,
      clientMessageId: clientMessageId || null,
      linkFlags,
      readBy: [senderId],
      deliveredTo: [senderId],
      ...(disappearingSec ? { expiresAt: new Date(Date.now() + disappearingSec * 1000) } : {}),
      ...(videoDoc ? { videoMeta: videoDoc } : {}),
      ...(audioDoc ? { audioMeta: audioDoc } : {}),
      ...(pollDoc ? { poll: pollDoc } : {}),
      ...(locationDoc ? { location: locationDoc } : {}),
      ...(liveLocationDoc ? { liveLocation: liveLocationDoc } : {}),
    });
  } catch (err) {
    // Race: a duplicate insert hit the unique (senderId, clientMessageId) index.
    if (err.code === 11000 && clientMessageId) {
      const existing = await Message.findOne({ senderId, clientMessageId });
      if (existing) {
        return {
          message: await populateMessage(Message.findById(existing._id)),
          duplicate: true,
          autoReplies: [],
        };
      }
    }
    throw err;
  }

  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessage: message._id,
    updatedAt: new Date(),
  });

  // Auto-unarchive (Module 20): an incoming message brings the conversation
  // back to the main list of every member who archived it (never the sender).
  await ConversationMember.updateMany(
    {
      conversationId,
      userId: { $ne: senderId },
      archived: true,
    },
    { $set: { archived: false } }
  );

  // Notifications for every other member (they can mute per conversation).
  const members = await ConversationMember.find({ conversationId });
  const toNotify = members.filter(
    (m) => m.userId.toString() !== senderId.toString() && !m.muted
  );
  if (toNotify.length) {
    await Notification.insertMany(
      toNotify.map((m) => ({
        recipientId: m.userId,
        senderId,
        type: 'message',
        conversationId,
        messageId: message._id,
      }))
    );
  }

  // Business auto-messages (module 30). When a customer writes to a business
  // profile in a private conversation, the business may auto-send:
  //  - a welcome message — once per conversation, on the customer's first
  //    message;
  //  - an away message — while closed per its working hours, at most once
  //    per conversation per 24 hours.
  // Loop safety: auto-messages are created directly here (never through
  // createMessage), always carry the autoReply marker, and this hook only
  // runs for ordinary user messages in private conversations — an
  // auto-reply can therefore never trigger another auto-reply, and the
  // business messaging a customer never triggers one either.
  const autoReplies = [];
  if (conversation && conversation.type === 'private') {
    const otherId = (conversation.participants || [])
      .map((p) => p.toString())
      .find((id) => id !== senderId.toString());
    if (otherId) {
      const other = await User.findById(otherId);
      const biz = other && other.business;
      if (other && biz && biz.isBusiness) {
        const makeAuto = async (kind, text) => {
          const auto = await Message.create({
            conversationId,
            senderId: other._id,
            content: text,
            messageType: 'text',
            autoReply: kind,
            readBy: [other._id],
            deliveredTo: [other._id],
          });
          await Conversation.findByIdAndUpdate(conversationId, {
            lastMessage: auto._id,
            updatedAt: new Date(),
          });
          autoReplies.push(await populateMessage(Message.findById(auto._id)));
        };
        if (biz.welcomeMessage) {
          const alreadyWelcomed = await Message.exists({
            conversationId,
            autoReply: 'welcome',
          });
          const senderMessageCount = await Message.countDocuments({
            conversationId,
            senderId,
          });
          if (!alreadyWelcomed && senderMessageCount <= 1) {
            await makeAuto('welcome', biz.welcomeMessage);
          }
        }
        if (biz.awayMessage && !isOpenAt(biz, new Date(), other.timezone || 'UTC')) {
          const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
          const recentAway = await Message.exists({
            conversationId,
            autoReply: 'away',
            createdAt: { $gt: dayAgo },
          });
          if (!recentAway) await makeAuto('away', biz.awayMessage);
        }
      }
    }
  }

  return {
    message: await populateMessage(Message.findById(message._id)),
    duplicate: false,
    autoReplies,
  };
}

// Read-side filter for disappearing messages: a message counts as present
// while it has no expiry or its expiry is still in the future. Spread this
// into every message query that feeds a user-visible read (history, unread
// counts, last-message previews). The TTL index removes the documents
// themselves in the background.
function notExpired() {
  return { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
}

module.exports = { createMessage, requireMembership, populateMessage, notExpired };
