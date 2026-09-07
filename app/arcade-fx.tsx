'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; radius: number; color: string };
export type Effects = { burst: (x: number, y: number, kind?: 'tap' | 'super' | 'reward' | 'bite') => void };
export const ArcadeEffects = forwardRef<Effects>(function ArcadeEffects(_, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef(0);
  const reduced = useRef(false);
  const previous = useRef(0);
  const drawRef = useRef<(time: number) => void>(() => {});
  useEffect(() => {
    const el = canvas.current!; const context = el.getContext('2d'); if (!context) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => { reduced.current = media.matches; if (media.matches) particles.current = []; };
    const resize = () => { const dpr = Math.min(devicePixelRatio || 1, 2); el.width = innerWidth * dpr; el.height = innerHeight * dpr; context.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const draw = (time: number) => {
      const dt = Math.min(32, time - (previous.current || time)) / 1000; previous.current = time;
      context.clearRect(0, 0, innerWidth, innerHeight);
      particles.current = particles.current.filter(p => p.life > 0);
      for (const p of particles.current) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 330 * dt; p.vx *= .988;
        context.globalAlpha = Math.max(0, p.life / p.max); context.fillStyle = p.color;
        context.beginPath(); context.arc(p.x, p.y, p.radius, 0, Math.PI * 2); context.fill();
      }
      context.globalAlpha = 1;
      frame.current = particles.current.length ? requestAnimationFrame(draw) : 0;
      if (!frame.current) previous.current = 0;
    };
    drawRef.current = draw; preference(); resize();
    media.addEventListener('change', preference); window.addEventListener('resize', resize);
    const pause = () => { if (document.hidden) { particles.current = []; cancelAnimationFrame(frame.current); frame.current = 0; context.clearRect(0, 0, innerWidth, innerHeight); } };
    document.addEventListener('visibilitychange', pause);
    return () => { cancelAnimationFrame(frame.current); media.removeEventListener('change', preference); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', pause); };
  }, []);
  useImperativeHandle(ref, () => ({ burst(x, y, kind = 'tap') {
    if (reduced.current || document.hidden) return;
    const colors = kind === 'bite' ? ['#ff4646', '#a31624', '#ffc78d'] : kind === 'tap' ? ['#2275ff', '#73baff', '#b4d7ff'] : ['#147aff', '#58b8ff', '#ffbd38', '#fff'];
    const count = kind === 'tap' ? 10 : 72;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2; const speed = (kind === 'tap' ? 110 : 290) * (.3 + Math.random());
      const life = .45 + Math.random() * .55;
      particles.current.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 80, life, max: life, radius: 1.5 + Math.random() * 3, color: colors[i % colors.length] });
    }
    if (particles.current.length > 180) particles.current.splice(0, particles.current.length - 180);
    if (!frame.current) frame.current = requestAnimationFrame(drawRef.current);
  } }), []);
  return <canvas ref={canvas} className="effects-canvas" aria-hidden="true" />;
});
