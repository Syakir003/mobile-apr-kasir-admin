'use client';

import * as React from 'react';

// Panel merek interaktif. Posisi kursor ditulis ke CSS variable lewat ref
// (bukan useState) supaya tidak re-render tiap gerakan mouse:
// --mx/--my = sorotan cahaya, --rx/--ry = kemiringan kartu logo,
// --px/--py = geseran garis aliran (parallax).
export function BrandPanel({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLElement>(null);

  function set(vars: Record<string, string>) {
    const el = ref.current;
    if (el) for (const k in vars) el.style.setProperty(k, vars[k]);
  }

  function onMove(e: React.PointerEvent<HTMLElement>) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    set({
      '--mx': x + 'px',
      '--my': y + 'px',
      '--rx': (y / r.height - 0.5) * -8 + 'deg',
      '--ry': (x / r.width - 0.5) * 8 + 'deg',
      '--px': (x / r.width - 0.5) * -24 + 'px',
      '--py': (y / r.height - 0.5) * -24 + 'px',
    });
  }

  function onLeave() {
    set({ '--rx': '0deg', '--ry': '0deg', '--px': '0px', '--py': '0px' });
  }

  return (
    <section
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="group relative hidden overflow-hidden bg-[linear-gradient(160deg,#0d7a70_0%,#0b6b62_45%,#064a43_100%)] text-white lg:flex lg:flex-col lg:p-14"
    >
      {/* Garis aliran udara: meniru lengkung pada logo. */}
      <svg
        aria-hidden
        viewBox="0 0 800 900"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute -inset-6 size-[calc(100%+3rem)] transition-transform duration-300 ease-out [transform:translate(var(--px,0px),var(--py,0px))]"
        fill="none"
        stroke="white"
        strokeLinecap="round"
      >
        <g strokeWidth="1.5" className="opacity-[0.28]">
          <path d="M-40 640 C 180 560, 360 470, 840 300" strokeDasharray="2 14" className="animate-airflow" />
          <path d="M-40 700 C 200 610, 400 520, 840 360" strokeDasharray="2 14" className="animate-airflow [animation-duration:30s]" />
          <path d="M-40 760 C 220 670, 440 570, 840 430" strokeDasharray="2 14" className="animate-airflow [animation-duration:26s]" />
        </g>
        <g strokeWidth="2" className="opacity-[0.32]">
          <path d="M-40 580 C 200 500, 380 400, 840 220" strokeDasharray="90 310" className="animate-airflow [animation-duration:18s]" />
          <path d="M-40 820 C 240 720, 460 610, 840 500" strokeDasharray="60 340" className="animate-airflow [animation-duration:24s]" />
        </g>
        <g strokeWidth="1" className="opacity-[0.16]">
          <path d="M-40 520 C 160 440, 340 330, 840 140" />
          <path d="M-40 880 C 260 780, 480 660, 840 570" />
        </g>
      </svg>
      {/* sorotan kursor */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), rgba(109,245,225,0.16), transparent 65%)',
        }}
      />
      {children}
    </section>
  );
}
