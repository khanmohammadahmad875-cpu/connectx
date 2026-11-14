import { useCallback, useRef } from 'react';
import { usePrefs } from '../context/PreferencesContext';

// Shared pointer-tilt handlers (polish items 5+7): the dashboard TiltCard
// effect, reusable on any element. Pointer-fine devices only; disabled
// under prefers-reduced-motion or when the user turned Animations off.
// Returns handlers to spread onto the element; pair with the .tilt-el CSS
// (transform-style preserve-3d + transition).
export function useTilt(maxDeg = 5) {
  const { prefs } = usePrefs();
  const rafRef = useRef(0);
  const enabled =
    prefs?.animationsEnabled !== false &&
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const onMove = useCallback(
    (e) => {
      if (!enabled) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        el.style.transform = `perspective(700px) rotateX(${(-py * maxDeg).toFixed(2)}deg) rotateY(${(px * maxDeg).toFixed(2)}deg) translateY(-2px)`;
      });
    },
    [enabled, maxDeg]
  );

  const onLeave = useCallback((e) => {
    cancelAnimationFrame(rafRef.current);
    e.currentTarget.style.transform = '';
  }, []);

  return enabled ? { onMouseMove: onMove, onMouseLeave: onLeave } : {};
}
