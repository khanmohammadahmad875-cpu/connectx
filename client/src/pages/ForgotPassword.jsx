import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import AuthBackground from '../components/AuthBackground';

// Password reset with the OTP scene, the way the big apps do it:
// step 1 the email, step 2 the 6-digit code typed into big boxes that
// AUTO-VERIFY the moment the last digit lands (typing, pasting, or the
// keyboard's one-time-code suggestion), with a 60-second resend timer
// and a shake + clear on a wrong code; step 3 the new password. The
// same email also carries the classic reset link for anyone who
// prefers it — both roads end at the same /reset-password endpoint.
export default function ForgotPassword() {
  const [step, setStep] = useState('email'); // email | code | password | done
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [shake, setShake] = useState(false);
  const boxRefs = useRef([]);
  const verifyingRef = useRef(false);

  // Resend countdown, like the big apps: "Send again in 0:47".
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // The first code box grabs the keyboard as soon as the step opens.
  useEffect(() => {
    if (step === 'code' && boxRefs.current[0]) boxRefs.current[0].focus();
  }, [step]);

  async function sendCode(e) {
    if (e) e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setDigits(['', '', '', '', '', '']);
      setResendIn(60);
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function setDigit(i, value) {
    const clean = value.replace(/\D/g, '');
    const next = [...digits];
    if (clean.length > 1) {
      // A paste (or the keyboard's code suggestion) fills every box.
      next.fill('');
      clean
        .slice(0, 6)
        .split('')
        .forEach((c, j) => {
          next[j] = c;
        });
      const target = Math.min(clean.length, 5);
      if (boxRefs.current[target]) boxRefs.current[target].focus();
    } else {
      next[i] = clean.slice(-1);
      if (clean && i < 5 && boxRefs.current[i + 1]) boxRefs.current[i + 1].focus();
    }
    setDigits(next);
    // The big-app behaviour: a complete code verifies itself.
    const code = next.join('');
    if (next.every((d) => d) && code.length === 6) verifyWith(code);
  }

  function onDigitKey(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0 && boxRefs.current[i - 1]) {
      boxRefs.current[i - 1].focus();
    }
  }

  async function verifyWith(code) {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setError('');
    setBusy(true);
    try {
      const res = await api('/api/auth/verify-reset-otp', {
        method: 'POST',
        body: { email, code },
      });
      setResetToken(res.resetToken);
      setStep('password');
    } catch (err) {
      setError('That code is not right or has expired. Please check and try again.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setDigits(['', '', '', '', '', '']);
      if (boxRefs.current[0]) boxRefs.current[0].focus();
    } finally {
      setBusy(false);
      verifyingRef.current = false;
    }
  }

  function verifyCode(e) {
    e.preventDefault();
    const code = digits.join('');
    if (code.length !== 6 || digits.some((d) => !d)) {
      setError('Please type the full 6-digit code.');
      return;
    }
    verifyWith(code);
  }

  async function setNewPassword(e) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: { token: resetToken, newPassword: password },
      });
      setStep('done');
    } catch (err) {
      setError('This reset has expired. Please start again to get a new code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <AuthBackground />
      <form
        className="auth-card"
        onSubmit={step === 'email' ? sendCode : step === 'code' ? verifyCode : step === 'password' ? setNewPassword : (e) => e.preventDefault()}
      >
        <div className="brand center">
          <span className="brand-mark">CX</span>
          <span className="brand-text">
            <span className="brand-name">ConnectX</span>
            <span className="brand-sub">by Developer Mohammad Ahmad Khan</span>
          </span>
        </div>
        <h1>Reset password</h1>
        {error && <p className="form-error">{error}</p>}

        {step === 'email' && (
          <>
            <p className="auth-sub">
              Enter your account email and we will send you a <strong>6-digit code</strong>.
            </p>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <p className="auth-sub">
              We sent a 6-digit code to <strong>{email}</strong>. Type it here — it works for
              10 minutes. (The same email also has a reset link, if you prefer that.)
            </p>
            <div className={`otp-row${shake ? ' shake' : ''}`} role="group" aria-label="6-digit code">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    boxRefs.current[i] = el;
                  }}
                  className="otp-box"
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={i === 0 ? 6 : 1}
                  value={d}
                  disabled={busy}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => onDigitKey(i, e)}
                  aria-label={`Digit ${i + 1}`}
                />
              ))}
            </div>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Verify code'}
            </button>
            <p className="auth-sub">
              No code yet?{' '}
              {resendIn > 0 ? (
                <span>
                  Send again in 0:{String(resendIn).padStart(2, '0')}
                </span>
              ) : (
                <button type="button" className="linklike" onClick={() => sendCode()} disabled={busy}>
                  Send again
                </button>
              )}
            </p>
          </>
        )}

        {step === 'password' && (
          <>
            <p className="auth-sub">Code verified ✅ — now choose your new password.</p>
            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <label>
              Type it again
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="auth-sub">
              ✅ Your password has been changed. You can now log in with your new password.
            </p>
            <Link className="btn primary" to="/login">
              Go to login
            </Link>
          </>
        )}

        <div className="auth-links">
          <Link to="/login">Back to login</Link>
        </div>
      </form>
    </div>
  );
}
