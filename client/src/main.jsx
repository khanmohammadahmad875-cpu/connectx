import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// The branded loading scene shows TWICE on a cold open, by design:
// (1) the boot splash painted with this HTML, held for its full showing
// here, then (2) the React LoadingScreen while the session restores
// (minimum-time gate in App.jsx). Total branding ≈ 2 seconds; the data
// itself still loads at full speed in the background.
const bootStart = window.__bootStart || performance.now();
const wait = Math.max(0, 1200 - (performance.now() - bootStart));

setTimeout(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}, wait);
