import { useEffect, useRef } from 'react';
import { usePrefs } from '../context/PreferencesContext';

// Animated live-weather background (polish item 6). One reusable Canvas 2D
// scene renderer in the spirit of AuthBackground: DPR-capped, ~30fps,
// pauses when hidden, modest particle counts. Under prefers-reduced-motion
// (or the user's Animations-off preference) it paints one static frame.
// Scenes: clear-day · clear-night · cloudy · rain · thunder · snow · fog.
const SCENE_GRADIENTS = {
  'clear-day': ['#4f83cc', '#8fc1e9', '#cfe8f7'],
  'clear-night': ['#060a1c', '#0d1836', '#1c2c52'],
  cloudy: ['#5b6b82', '#8494ab', '#aebdd0'],
  rain: ['#2e3d55', '#43597a', '#5d7595'],
  thunder: ['#1d2739', '#2c3c58', '#41577a'],
  snow: ['#7186a3', '#9db2c9', '#cfdde9'],
  fog: ['#6d7a89', '#93a1ae', '#bcc6cd'],
};

function makeClouds(count, w, h, dark) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h * 0.45,
    r: 24 + Math.random() * 55,
    speed: 3 + Math.random() * 8,
    alpha: dark ? 0.35 + Math.random() * 0.3 : 0.5 + Math.random() * 0.35,
  }));
}

export default function WeatherScene({ scene, className = '' }) {
  const canvasRef = useRef(null);
  const { prefs } = usePrefs();
  const animationsOff = prefs?.animationsEnabled === false;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || animationsOff;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0;
    let H = 0;
    let raf = 0;
    let last = 0;
    let running = true;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduced) draw(0);
    }

    const dark = scene === 'rain' || scene === 'thunder';
    let clouds = [];
    let backClouds = [];
    let drops = [];
    let flakes = [];
    let stars = [];
    let mists = [];
    let flash = 0;
    let nextFlash = 2500 + Math.random() * 5000;

    function seed() {
      clouds = makeClouds(scene === 'clear-day' || scene === 'clear-night' ? 5 : 9, W, H, dark);
      backClouds = makeClouds(6, W, H, dark);
      drops = Array.from({ length: 90 }, () => ({
        x: Math.random() * W, y: Math.random() * H, len: 10 + Math.random() * 14, speed: 380 + Math.random() * 260,
      }));
      flakes = Array.from({ length: 70 }, () => ({
        x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.4, speed: 22 + Math.random() * 38, sway: Math.random() * Math.PI * 2,
      }));
      stars = Array.from({ length: 90 }, () => ({
        x: Math.random() * W, y: Math.random() * H * 0.75, r: Math.random() * 1.3 + 0.3, tw: Math.random() * Math.PI * 2,
      }));
      mists = Array.from({ length: 5 }, (_, i) => ({
        x: Math.random() * W, y: H * (0.25 + i * 0.16), w: W * (0.55 + Math.random() * 0.5), speed: 5 + Math.random() * 9, alpha: 0.10 + Math.random() * 0.10,
      }));
    }

    function cloudShape(c, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.r * 1.7, c.r * 0.62, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - c.r * 0.8, c.y + c.r * 0.12, c.r * 0.95, c.r * 0.45, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + c.r * 0.85, c.y + c.r * 0.1, c.r * 1.05, c.r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    function draw(t) {
      const grads = SCENE_GRADIENTS[scene] || SCENE_GRADIENTS['clear-day'];
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, grads[0]);
      g.addColorStop(0.6, grads[1]);
      g.addColorStop(1, grads[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      if (scene === 'clear-night') {
        ctx.fillStyle = '#ffffff';
        for (const s of stars) {
          ctx.globalAlpha = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t / 900 + s.tw));
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        // moon
        const mx = W * 0.78;
        const my = H * 0.18;
        const mg = ctx.createRadialGradient(mx, my, 4, mx, my, 60);
        mg.addColorStop(0, 'rgba(240,244,255,0.9)');
        mg.addColorStop(0.35, 'rgba(214,226,255,0.35)');
        mg.addColorStop(1, 'rgba(214,226,255,0)');
        ctx.fillStyle = mg;
        ctx.fillRect(mx - 60, my - 60, 120, 120);
        ctx.fillStyle = '#e9eefb';
        ctx.beginPath();
        ctx.arc(mx, my, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(190,202,228,0.5)';
        ctx.beginPath();
        ctx.arc(mx - 5, my - 3, 4, 0, Math.PI * 2);
        ctx.arc(mx + 6, my + 6, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      if (scene === 'clear-day') {
        const sx = W * 0.8;
        const sy = H * 0.16;
        const sg = ctx.createRadialGradient(sx, sy, 6, sx, sy, 110);
        sg.addColorStop(0, 'rgba(255,236,170,0.95)');
        sg.addColorStop(0.3, 'rgba(255,224,130,0.45)');
        sg.addColorStop(1, 'rgba(255,224,130,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(sx - 110, sy - 110, 220, 220);
        ctx.fillStyle = '#ffdf7e';
        ctx.beginPath();
        ctx.arc(sx, sy, 24, 0, Math.PI * 2);
        ctx.fill();
      }

      const backColor = dark ? 'rgba(38,50,72,0.5)' : 'rgba(255,255,255,0.35)';
      for (const c of backClouds) cloudShape(c, backColor);
      const cloudColor = (a) => (dark ? `rgba(30,40,60,${a})` : `rgba(255,255,255,${a})`);
      for (const c of clouds) cloudShape(c, cloudColor(c.alpha));

      if (scene === 'rain' || scene === 'thunder') {
        ctx.strokeStyle = 'rgba(200,220,245,0.55)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (const d of drops) {
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - 2.5, d.y + d.len);
        }
        ctx.stroke();
        if (scene === 'thunder' && flash > 0.02) {
          ctx.fillStyle = `rgba(235,240,255,${flash * 0.35})`;
          ctx.fillRect(0, 0, W, H);
        }
      }

      if (scene === 'snow') {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (const f of flakes) {
          ctx.beginPath();
          ctx.arc(f.x + Math.sin(t / 1400 + f.sway) * 8, f.y, f.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (scene === 'fog') {
        for (const m of mists) {
          const mg = ctx.createRadialGradient(m.x, m.y, 4, m.x, m.y, m.w / 2);
          mg.addColorStop(0, `rgba(235,240,244,${m.alpha})`);
          mg.addColorStop(1, 'rgba(235,240,244,0)');
          ctx.fillStyle = mg;
          ctx.save();
          ctx.translate(m.x, m.y);
          ctx.scale(1, 0.16);
          ctx.translate(-m.x, -m.y);
          ctx.fillRect(m.x - m.w / 2, m.y - m.w / 2, m.w, m.w);
          ctx.restore();
        }
      }
    }

    function step(t, dt) {
      const s = dt / 1000;
      for (const c of clouds) { c.x += c.speed * s; if (c.x - c.r * 2 > W) c.x = -c.r * 2; }
      for (const c of backClouds) { c.x += c.speed * 0.5 * s; if (c.x - c.r * 2 > W) c.x = -c.r * 2; }
      for (const d of drops) { d.y += d.speed * s; d.x -= d.speed * 0.12 * s; if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 40); } }
      for (const f of flakes) { f.y += f.speed * s; if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; } }
      for (const m of mists) { m.x += m.speed * s; if (m.x - m.w / 2 > W) m.x = -m.w / 2; }
      if (scene === 'thunder') {
        nextFlash -= dt;
        if (nextFlash <= 0) { flash = 1; nextFlash = 2600 + Math.random() * 5200; }
        flash = Math.max(0, flash - dt / 260);
      }
      draw(t);
    }

    function loop(now) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return; // ~30fps cap
      const dt = Math.min(100, now - last || 33);
      last = now;
      step(now, dt);
    }

    function onVis() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        running = true;
        last = 0;
        raf = requestAnimationFrame(loop);
      }
    }

    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
    document.addEventListener('visibilitychange', onVis);
    if (!reduced) raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [scene, animationsOff]);

  if (!scene) return null;
  return <canvas ref={canvasRef} className={`weather-scene ${className}`} aria-hidden="true" />;
}
