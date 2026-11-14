import { useTilt } from '../hooks/useTilt';

// Glass card with a subtle CSS-transform 3D tilt that follows the pointer.
// Transform-only animation; disabled entirely for reduced-motion users, when
// the user turns Animations off, and harmless on touch devices (no hover).
export default function TiltCard({ className = '', children, onClick }) {
  const tilt = useTilt(5);
  return (
    <div className={`tilt-card ${className}`} onClick={onClick} {...tilt}>
      {children}
    </div>
  );
}
