// Branded app-opening screen: the ConnectX wordmark on top, the glossy
// CX badge under it pulsing inside the loading rings, the developer
// credit with AHMAD mixed in as gradient caps, and an indeterminate
// gradient progress bar. Shown while the session restores; a matching
// static copy lives in index.html so the very first paint (before the
// JS bundle arrives) looks exactly the same.
import { useEffect, useRef, useState } from 'react';

// Minimum-time gate (second showing of the loading scene): once the
// splash appears it stays for at least `ms`, even if the session check
// finishes sooner — the branding gets its full moment on every cold
// open, while real loading continues in parallel.
export function useSplashMin(loading, ms = 900) {
  const [show, setShow] = useState(loading);
  const startRef = useRef(null);
  useEffect(() => {
    if (loading) {
      if (startRef.current === null) startRef.current = Date.now();
      setShow(true);
      return undefined;
    }
    if (startRef.current === null) {
      setShow(false);
      return undefined;
    }
    const left = ms - (Date.now() - startRef.current);
    if (left <= 0) {
      setShow(false);
      return undefined;
    }
    const t = setTimeout(() => setShow(false), left);
    return () => clearTimeout(t);
  }, [loading, ms]);
  return show;
}

export default function LoadingScreen() {
  const letters = 'ConnectX'.split('');
  return (
    <div className="splash" role="status" aria-label="Loading ConnectX">
      <h1 className="splash-word" aria-label="ConnectX">
        {letters.map((ch, i) => (
          <span
            key={i}
            className={`splash-letter l${i}`}
            style={{ animationDelay: `${i * 0.08}s` }}
            aria-hidden="true"
          >
            {ch}
          </span>
        ))}
      </h1>
      <div className="splash-badge">
        <span>CX</span>
        <i className="splash-ring" aria-hidden="true" />
        <i className="splash-ring late" aria-hidden="true" />
      </div>
      <p className="splash-by">
        by Developer Mohammad <b className="splash-ahmad">AHMAD</b> Khan
      </p>
      <div className="splash-bar" aria-hidden="true">
        <i />
      </div>
      <div className="splash-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
