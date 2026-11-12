import { initials } from '../utils/format';

export default function Avatar({ name, src, online, size = 44 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return (
    <span className="avatar-wrap" style={{ width: size, height: size }}>
      {src ? (
        <img className="avatar-img" src={src} alt={name || 'avatar'} style={style} />
      ) : (
        <span className="avatar-fallback" style={style}>
          {initials(name || '?')}
        </span>
      )}
      {online !== undefined && <span className={`presence-dot ${online ? 'on' : 'off'}`} />}
    </span>
  );
}
