import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import Avatar from '../Avatar';
import { conversationAvatar, conversationTitle } from '../../utils/format';
import {
  clearUnlockToken,
  hasUnlockGrant,
  setUnlockToken,
} from '../../utils/lock';

// Locked Chats area (Modules 19 + 21). Nothing about a locked chat is shown
// until the PIN verifies server-side and issues the unlock grant; hidden
// chats additionally need the secret code to even be listed.
export default function LockedPanel({ myId, onBack, onOpenConversation, onUnlocked, onLockStateChanged }) {
  const [status, setStatus] = useState(null);
  const [locked, setLocked] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [unlocked, setUnlocked] = useState(hasUnlockGrant());
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [secret, setSecret] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [password, setPassword] = useState('');
  const [showManage, setShowManage] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api('/api/chat-locks/status');
      setStatus(data);
    } catch (err) {
      /* ignore */
    }
  }, []);

  const loadLocked = useCallback(async () => {
    if (!hasUnlockGrant()) return;
    try {
      const data = await api('/api/chat-locks/conversations', { unlock: true });
      setLocked(data.conversations || []);
    } catch (err) {
      if (err.status === 423) {
        clearUnlockToken();
        setUnlocked(false);
      }
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadLocked();
  }, [loadStatus, loadLocked]);

  async function run(fn, successNote) {
    setError('');
    setNote('');
    try {
      await fn();
      if (successNote) setNote(successNote);
      await loadStatus();
      await loadLocked();
      if (onLockStateChanged) onLockStateChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function setupPin() {
    if (pin !== pinConfirm) return setError('PINs do not match');
    await run(async () => {
      await api('/api/chat-locks/pin', { method: 'POST', body: { pin } });
      setPin('');
      setPinConfirm('');
    }, 'PIN set. You can now lock chats from their details panel.');
  }

  async function unlock() {
    setError('');
    try {
      const data = await api('/api/chat-locks/unlock', { method: 'POST', body: { pin } });
      setUnlockToken(data.unlockToken, data.expiresAt);
      setUnlocked(true);
      setPin('');
      if (onUnlocked) onUnlocked();
      const list = await api('/api/chat-locks/conversations', { unlock: true });
      setLocked(list.conversations || []);
      await loadStatus();
    } catch (err) {
      setError(err.message);
    }
  }

  function lockNow() {
    clearUnlockToken();
    setUnlocked(false);
    setLocked([]);
    setHidden([]);
  }

  async function reveal() {
    setError('');
    try {
      const data = await api('/api/chat-locks/reveal', {
        method: 'POST',
        body: { secretCode: secret },
      });
      setHidden(data.conversations || []);
      setSecret('');
      if ((data.conversations || []).length === 0) setNote('No hidden chats found.');
    } catch (err) {
      setError(err.message);
    }
  }

  function renderRow(conv, { hiddenRow = false } = {}) {
    const title = conversationTitle(conv, myId);
    return (
      <div key={conv._id} className="conv-item" onClick={() => onOpenConversation(conv._id)} role="button" tabIndex={0}>
        <Avatar name={title} src={conversationAvatar(conv, myId)} />
        <span className="conv-main">
          <span className="conv-top">
            <span className="conv-title">{hiddenRow ? '🙈 ' : '🔒 '}{title}</span>
          </span>
          <span className="conv-bottom">
            <span className="conv-preview">
              {conv.type === 'channel' ? 'Channel' : conv.type === 'group' ? 'Group' : 'Private chat'}
            </span>
            {conv.unreadCount > 0 && <span className="unread-badge">{conv.unreadCount}</span>}
          </span>
        </span>
        {!hiddenRow ? (
          <>
            <button
              className="conv-action"
              title="Hide this chat (secret code needed to reveal)"
              onClick={(e) => {
                e.stopPropagation();
                run(
                  () => api(`/api/chat-locks/${conv._id}/hide`, { method: 'POST', body: { hidden: true } }),
                  'Chat hidden. It now needs your secret code to reveal.'
                );
              }}
            >
              🙈
            </button>
            <button
              className="conv-action"
              title="Remove lock"
              onClick={(e) => {
                e.stopPropagation();
                run(
                  () => api(`/api/chat-locks/${conv._id}`, { method: 'DELETE', unlock: true }),
                  'Lock removed.'
                );
              }}
            >
              🔓
            </button>
          </>
        ) : (
          <button
            className="conv-action"
            title="Unhide (move back to locked chats)"
            onClick={(e) => {
              e.stopPropagation();
              run(async () => {
                await api(`/api/chat-locks/${conv._id}/hide`, {
                  method: 'POST',
                  body: { hidden: false },
                  unlock: true,
                });
                setHidden((prev) => prev.filter((c) => c._id !== conv._id));
              }, 'Chat moved back to locked chats.');
            }}
          >
            ↩
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="conv-list-wrap">
      <div className="conv-search-row">
        <button className="icon-btn" title="Back to chats" onClick={onBack}>←</button>
        <span className="list-view-title inline">🔒 Locked chats</span>
        {unlocked && (
          <button className="btn small ghost" onClick={lockNow}>Lock now</button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      {note && <p className="ok-note">{note}</p>}

      {status && !status.hasPin && (
        <div className="lock-box">
          <p className="info-sub">
            Set a 4–6 digit PIN to protect chats. Locked chats disappear from your chat list and
            can only be opened here, with your PIN.
          </p>
          <input
            className="text-input"
            type="password"
            inputMode="numeric"
            placeholder="New PIN (4–6 digits)"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <input
            className="text-input"
            type="password"
            inputMode="numeric"
            placeholder="Confirm PIN"
            value={pinConfirm}
            onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <button className="btn primary" onClick={setupPin}>Set PIN</button>
        </div>
      )}

      {status && status.hasPin && !unlocked && (
        <div className="lock-box">
          <p className="info-sub">
            {status.lockedCount + status.hiddenCount} chat(s) locked. Enter your PIN to view them.
          </p>
          <input
            className="text-input"
            type="password"
            inputMode="numeric"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && unlock()}
          />
          <button className="btn primary" onClick={unlock}>Unlock</button>
        </div>
      )}

      {unlocked && (
        <>
          <div className="conv-list">
            {locked.length === 0 && <p className="empty-note">No locked chats.</p>}
            {locked.map((conv) => renderRow(conv))}
          </div>

          <div className="lock-box">
            <h5 className="info-section">🙈 Hidden chats</h5>
            {status && !status.hasSecret ? (
              <>
                <p className="info-sub">
                  Set a secret code to hide locked chats completely — they will not appear above
                  until the code is entered.
                </p>
                <input
                  className="text-input"
                  type="password"
                  placeholder="Secret code (min 4 characters)"
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                />
                <button
                  className="btn small primary"
                  onClick={() =>
                    run(async () => {
                      await api('/api/chat-locks/secret', {
                        method: 'POST',
                        body: { secretCode: newSecret },
                      });
                      setNewSecret('');
                    }, 'Secret code set.')
                  }
                >
                  Set secret code
                </button>
              </>
            ) : (
              <>
                <div className="inline-form">
                  <input
                    className="text-input"
                    type="password"
                    placeholder="Enter secret code to reveal hidden chats"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && reveal()}
                  />
                  <button className="btn small primary" onClick={reveal}>Reveal</button>
                </div>
                <div className="conv-list">
                  {hidden.map((conv) => renderRow(conv, { hiddenRow: true }))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {status && status.hasPin && (
        <div className="lock-box">
          <button className="btn small ghost" onClick={() => setShowManage((s) => !s)}>
            {showManage ? 'Hide PIN settings' : 'PIN settings / recovery'}
          </button>
          {showManage && (
            <>
              <h5 className="info-section">Change PIN</h5>
              <input
                className="text-input"
                type="password"
                inputMode="numeric"
                placeholder="Current PIN"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <input
                className="text-input"
                type="password"
                inputMode="numeric"
                placeholder="New PIN"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <button
                className="btn small primary"
                onClick={() =>
                  run(async () => {
                    await api('/api/chat-locks/pin/change', {
                      method: 'POST',
                      body: { currentPin, newPin },
                    });
                    setCurrentPin('');
                    setNewPin('');
                  }, 'PIN changed.')
                }
              >
                Change PIN
              </button>
              <h5 className="info-section">Forgot PIN or secret code?</h5>
              <input
                className="text-input"
                type="password"
                placeholder="Your account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="inline-form">
                <button
                  className="btn small ghost"
                  onClick={() =>
                    run(async () => {
                      await api('/api/chat-locks/pin/reset', {
                        method: 'POST',
                        body: { password },
                      });
                      lockNow();
                    }, 'PIN reset. Set a new PIN to unlock your chats.')
                  }
                >
                  Reset PIN
                </button>
                <button
                  className="btn small ghost"
                  onClick={() =>
                    run(async () => {
                      await api('/api/chat-locks/secret/reset', {
                        method: 'POST',
                        body: { password },
                      });
                      setHidden([]);
                    }, 'Secret code reset — hidden chats are back in the locked list.')
                  }
                >
                  Reset secret code
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
