import { useState } from 'react';
import { initials } from '../utils/format';

export default function Avatar({ name, src, online, size = 44 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  // A stored URL can outlive the file behind it (uploads live on ephemeral
  // disk) — when the image fails to load, fall back to initials instead of
  // showing a broken-image icon. Tracked per-src so a new URL retries.
  const [brokenSrc, setBrokenSrc] = useState(null);
  const showImage = !!src && brokenSrc !== src;
  return (
    <span className="avatar-wrap" style={{ width: size, height: size }}>
      {showImage ? (
        <img
          className="avatar-img"
          src={src}
          alt={name || 'avatar'}
          style={style}
          onError={() => setBrokenSrc(src)}
        />
      ) : (
        <span className="avatar-fallback" style={style}>
          {initials(name || '?')}
        </span>
      )}
      {online !== undefined && <span className={`presence-dot ${online ? 'on' : 'off'}`} />}
    </span>
  );
}
