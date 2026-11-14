// Branded app-opening screen: the ConnectX wordmark on top, the glossy
// CX badge under it pulsing inside the loading rings, the developer
// credit with AHMAD mixed in as gradient caps, and an indeterminate
// gradient progress bar. Shown while the session restores; a matching
// static copy lives in index.html so the very first paint (before the
// JS bundle arrives) looks exactly the same.
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
