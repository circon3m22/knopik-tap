'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Mood } from './arcade-engine';

export const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') ?? ''}${path}`;
export const number = (value: number) => value.toLocaleString('ru-RU');
export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    play: <><path d="m9 5 10 7-10 7Z" /><path d="M4 5v14" /></>,
    bag: <><path d="M5 7h14l1 14H4L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    gift: <><path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12" /><path d="M12 9C2 9 5 1 9 4l3 5Zm0 0c10 0 7-8 3-5l-3 5Z" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><path d="M8 3v6M16 9v6M9 15v6" /></>,
    safe: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="12" cy="12" r="4" /><path d="m9 9 6 6m0-6-6 6M18 8v2" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    trophy: <><path d="M8 3h8v7a4 4 0 0 1-8 0V3ZM12 14v6M8 21h8M8 5H3v3a5 5 0 0 0 5 5m8-8h5v3a5 5 0 0 1-5 5" /></>,
    heart: <path d="M20 5c-3-3-6-1-8 1C10 4 7 2 4 5c-5 5 8 15 8 15S25 10 20 5Z" />,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.bolt}</svg>;
}
export function Portrait({ mood = 'neutral', hat = false, mohawk = false }: { mood?: Mood; hat?: boolean; mohawk?: boolean }) {
  return <span className={`knopik-portrait face-${mood}`} aria-hidden="true">
    <span className="portrait-crop">
      <img className="portrait-face face-calm" src={asset('/knopik-calm-earless.webp')} alt="" draggable={false} />
      <img className="portrait-face face-warning" src={asset('/knopik-warning-earless.webp')} alt="" draggable={false} />
      <img className="portrait-face face-joy sprite" src={asset('/knopik-joy-sprite-earless.webp')} alt="" draggable={false} />
      <img className="portrait-face face-rage sprite" src={asset('/knopik-rage-sprite-earless.webp')} alt="" draggable={false} />
    </span>
    <img className="portrait-ear ear-left" src={asset('/knopik-ear-left.png')} alt="" draggable={false} />
    <img className="portrait-ear ear-right" src={asset('/knopik-ear-right.png')} alt="" draggable={false} />
    {hat && <img className="portrait-hat" src={asset('/hasbik-tubeteika.png')} alt="" />}
    {mohawk && <img className="portrait-mohawk" src={asset('/knopik-mohawk-v2.png')} alt="" />}
  </span>;
}
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!; const trigger = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => { el.close(); trigger?.focus(); };
  }, []);
  return <dialog className="arcade-dialog" aria-labelledby={titleId} ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-inner"><div className="section-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Закрыть" onClick={onClose}><Icon name="close" /></button></div>{children}</div>
  </dialog>;
}
