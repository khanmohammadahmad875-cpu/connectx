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

// Night versions of the weather skies: same weather, after dark. The
// scene follows the clock — sun by day, moon + stars by night — with
// the weather (clouds, rain, snow) layered over the sky either way.
const NIGHT_GRADIENTS = {
  cloudy: ['#131c2e', '#24334d', '#3a4f6e'],
  rain: ['#0d1626', '#1a2a44', '#2a4062'],
  thunder: ['#090f1e', '#16223a', '#27395c'],
  snow: ['#1b2740', '#2e405f', '#49607f'],
  fog: ['#141d2b', '#263449', '#3d526c'],
};

function makeClouds(count, w, h, dark) {
  // Real-looking clouds, not cartoon ellipses: each cloud is a cluster
  // of ~16 soft puffs (radial gradients, brighter dome over a grey
  // shaded base) baked ONCE into an offscreen sprite (see buildSprite),
  // then blitted each frame — photographic softness at no per-frame
  // gradient cost. Sizes stay modest and the band stays in the top sky
  // so the scene never fights the content again.
  return Array.from({ length: count }, () => {
    const r = 15 + Math.random() * 26;
    const puffs = [];
    for (let i = 0; i < 16; i++) {
      const dx = (Math.random() * 2 - 1) * r * 1.5;
      const dy = -Math.abs(dx) * 0.16 - r * 0.08 + (Math.random() - 0.5) * r * 0.35;
      const pr = Math.max(6, r * (0.38 + Math.random() * 0.5) * (1 - Math.abs(dx) / (r * 2.4)));
      puffs.push({ dx, dy, pr, a: 0.1 + Math.random() * 0.12 });
    }
    return {
      x: Math.random() * w,
      y: Math.random() * h * 0.38,
      r,
      speed: 3 + Math.random() * 8,
      alpha: 0.7 + Math.random() * 0.3,
      puffs,
      sprite: null,
      sw: 0,
      sh: 0,
    };
  });
}

export default function WeatherScene({ scene, night = false, className = '' }) {
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

    const dark = night || scene === 'rain' || scene === 'thunder';
    let clouds = [];
    let backClouds = [];
    let drops = [];
    let flakes = [];
    let stars = [];
    let mists = [];
    let flash = 0;
    let nextFlash = 2500 + Math.random() * 5000;

    // Bake one cloud into an offscreen sprite: a grey shaded base pass
    // (offset down) under a bright white dome pass, every puff a radial
    // gradient fading to nothing — that's what makes it read as a real
    // cloud instead of a flat cartoon shape.
    function buildSprite(c) {
      const sw = Math.ceil(c.r * 4.6);
      const sh = Math.ceil(c.r * 2.6);
      const cv = document.createElement('canvas');
      cv.width = Math.round(sw * dpr);
      cv.height = Math.round(sh * dpr);
      const g2 = cv.getContext('2d');
      if (!g2) return;
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = sw / 2;
      const cy = sh / 2;
      const passes = [
        { dyOff: c.r * 0.22, col: dark ? '96,112,140' : '163,178,199', mul: 0.75 },
        { dyOff: 0, col: dark ? '188,200,220' : '255,255,255', mul: 1 },
      ];
      for (const p of passes) {
        for (const pf of c.puffs) {
          const x = cx + pf.dx;
          const y = cy + pf.dy + p.dyOff;
          const grad = g2.createRadialGradient(x, y, 0, x, y, pf.pr);
          grad.addColorStop(0, `rgba(${p.col},${(pf.a * p.mul).toFixed(3)})`);
          grad.addColorStop(1, `rgba(${p.col},0)`);
          g2.fillStyle = grad;
          g2.beginPath();
          g2.arc(x, y, pf.pr, 0, Math.PI * 2);
          g2.fill();
        }
      }
      c.sprite = cv;
      c.sw = sw;
      c.sh = sh;
    }

    function seed() {
      clouds = makeClouds(scene === 'clear-day' || scene === 'clear-night' ? 4 : 6, W, H, dark);
      backClouds = makeClouds(4, W, H, dark);
      clouds.forEach(buildSprite);
      backClouds.forEach(buildSprite);
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

    function drawCloud(c) {
      if (!c.sprite) return;
      ctx.drawImage(c.sprite, c.x - c.sw / 2, c.y - c.sh / 2, c.sw, c.sh);
    }

    function draw(t) {
      const baseGrads = SCENE_GRADIENTS[scene] || SCENE_GRADIENTS['clear-day'];
      const grads = night ? NIGHT_GRADIENTS[scene] || baseGrads : baseGrads;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, grads[0]);
      g.addColorStop(0.6, grads[1]);
      g.addColorStop(1, grads[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // The sky follows the clock on EVERY scene: sun by day, moon and
      // stars by night, with the weather layered over them. Heavier
      // weather hides more of the sky (cover factor).
      const cover =
        scene === 'clear-day' || scene === 'clear-night'
          ? 0
          : scene === 'cloudy'
            ? 0.45
            : scene === 'fog'
              ? 0.6
              : 0.7;

      if (night) {
        const starStrength = 1 - cover * 0.8;
        ctx.fillStyle = '#ffffff';
        for (const s of stars) {
          ctx.globalAlpha = (0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t / 900 + s.tw))) * starStrength;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        // moon (dimmed by cloud cover, like the real thing)
        const moonStrength = 1 - cover * 0.65;
        const mx = W * 0.78;
        const my = H * 0.18;
        const mg = ctx.createRadialGradient(mx, my, 4, mx, my, 60);
        mg.addColorStop(0, `rgba(240,244,255,${0.9 * moonStrength})`);
        mg.addColorStop(0.35, `rgba(214,226,255,${0.35 * moonStrength})`);
        mg.addColorStop(1, 'rgba(214,226,255,0)');
        ctx.fillStyle = mg;
        ctx.fillRect(mx - 60, my - 60, 120, 120);
        ctx.globalAlpha = moonStrength;
        ctx.fillStyle = '#e9eefb';
        ctx.beginPath();
        ctx.arc(mx, my, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(190,202,228,0.5)';
        ctx.beginPath();
        ctx.arc(mx - 5, my - 3, 4, 0, Math.PI * 2);
        ctx.arc(mx + 6, my + 6, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // sun (softened when the weather covers the sky)
        const sunStrength = 1 - cover * 0.6;
        const sx = W * 0.8;
        const sy = H * 0.16;
        const sg = ctx.createRadialGradient(sx, sy, 6, sx, sy, 110);
        sg.addColorStop(0, `rgba(255,236,170,${0.95 * sunStrength})`);
        sg.addColorStop(0.3, `rgba(255,224,130,${0.45 * sunStrength})`);
        sg.addColorStop(1, 'rgba(255,224,130,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(sx - 110, sy - 110, 220, 220);
        ctx.globalAlpha = sunStrength;
        ctx.fillStyle = '#ffdf7e';
        ctx.beginPath();
        ctx.arc(sx, sy, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      for (const c of backClouds) {
        ctx.globalAlpha = c.alpha * 0.55;
        drawCloud(c);
      }
      ctx.globalAlpha = 1;
      for (const c of clouds) {
        ctx.globalAlpha = c.alpha;
        drawCloud(c);
      }
      ctx.globalAlpha = 1;

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
      for (const c of clouds) { c.x += c.speed * s; if (c.x - c.sw / 2 > W) c.x = -c.sw / 2; }
      for (const c of backClouds) { c.x += c.speed * 0.5 * s; if (c.x - c.sw / 2 > W) c.x = -c.sw / 2; }
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
  }, [scene, night, animationsOff]);

  if (!scene) return null;
  return <canvas ref={canvasRef} className={`weather-scene ${className}`} aria-hidden="true" />;
}
