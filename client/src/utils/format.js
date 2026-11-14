// Small display helpers shared across the chat UI.

export function initials(name = '?') {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatLastSeen(iso) {
  if (!iso) return 'last seen recently';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `last seen today at ${formatTime(iso)}`;
  return `last seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${formatTime(iso)}`;
}

export function otherParticipant(conversation, myId) {
  if (!conversation || conversation.type !== 'private') return null;
  return (conversation.participants || []).find((p) => p._id !== myId) || null;
}

export function conversationTitle(conversation, myId) {
  if (!conversation) return '';
  if (conversation.type === 'group' || conversation.type === 'channel') {
    return conversation.groupName || (conversation.type === 'channel' ? 'Channel' : 'Group');
  }
  const other = otherParticipant(conversation, myId);
  return other ? other.username : 'Conversation';
}

export function conversationAvatar(conversation, myId) {
  if (!conversation) return '';
  if (conversation.type === 'group' || conversation.type === 'channel') {
    return conversation.groupImage || '';
  }
  const other = otherParticipant(conversation, myId);
  return other ? other.profilePicture || '' : '';
}

export function isConversationOnline(conversation, myId) {
  if (!conversation || conversation.type !== 'private') return false;
  const other = otherParticipant(conversation, myId);
  return !!other && other.status === 'online';
}

// Tiny notification beep (no audio file needed).
let audioCtx = null;
export function playNotificationSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
  } catch (err) {
    /* sound is best-effort */
  }
}
