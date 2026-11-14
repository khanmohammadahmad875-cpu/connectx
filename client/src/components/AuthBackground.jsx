import { useEffect, useRef } from 'react';

// Lightweight animated background for the auth screens: soft drifting
// particles on a 2D canvas (no WebGL). Motion uses transform-free canvas
// drawing at a capped frame cost, pauses when the tab is hidden, and renders
// a single static frame when the user prefers reduced motion.
export default function AuthBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const COLORS = ['47,123,255', '122,181,255', '47,212,140', '139,92,246'];
    let particles = [];
    let raf = 0;
    let width = 0;
    let height = 0;

    function seed() {
      const count = Math.min(42, Math.floor((width * height) / 38000));
      particles = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1 + Math.random() * 2.6,
        vx: (Math.random() - 0.5) * 0.18,
        vy: -0.08 - Math.random() * 0.25,
        color: COLORS[i % COLORS.length],
        alpha: 0.25 + Math.random() * 0.5,
      }));
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function drawFrame() {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
        ctx.fill();
      }
    }

    function tick() {
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -6) {
          p.y = height + 6;
          p.x = Math.random() * width;
        }
        if (p.x < -6) p.x = width + 6;
        if (p.x > width + 6) p.x = -6;
      }
      drawFrame();
      raf = requestAnimationFrame(tick);
    }

    resize();
    if (reduced) {
      drawFrame();
    } else {
      raf = requestAnimationFrame(tick);
    }
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas className="auth-bg-canvas" aria-hidden="true" ref={canvasRef} />;
}
