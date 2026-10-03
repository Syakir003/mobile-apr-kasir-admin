import * as React from 'react';

// Lembar formulir cetak berukuran tetap. Semua koordinat memakai satuan piksel
// gambar formulir asli (Invoice-Contoh.jpeg 1271x954, surat-jalan-contoh.jpeg
// 854x1280), jadi proporsi kotak, tebal garis, dan tinggi baris sama persis
// dengan formulir fisik di ukuran kertas berapa pun (diskalakan dengan lebar
// wadah lewat container query unit `cqw`).

// Arial Narrow Bold seperti pada formulir asli. Liberation Sans Narrow punya
// metrik yang sama (Linux/Mac), Roboto Condensed sebagai cadangan terakhir.
export const FORM_FONT =
  '"Arial Narrow", "Liberation Sans Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';

const u = (n: number) => `calc(${n} * var(--u))`;
// koordinat di gambar -> posisi di lembar (dikurangi pergeseran awal --ox/--oy)
const px = (x: number) => `calc((${x} - var(--ox)) * var(--u))`;
const py = (y: number) => `calc((${y} - var(--oy)) * var(--u))`;
// tebal garis: ikut skala, tapi tidak kurang dari 0.25mm supaya tetap tercetak
// (x1.33: tebal garis hasil ukur formulir asli ~1.9 satuan untuk garis baris, ~2.6 untuk garis tabel)
const thick = (t: number) => `max(${u(t * 1.33)}, 0.25mm)`;

export function FormSheet({
  w,
  h,
  ox,
  oy,
  children,
}: {
  w: number;
  h: number;
  /** titik awal (kiri-atas) area yang dicetak, dalam koordinat gambar asli */
  ox: number;
  oy: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ containerType: 'inline-size', width: '100%' }}>
      <div
        style={
          {
            '--u': `calc(100cqw / ${w})`,
            '--ox': ox,
            '--oy': oy,
            position: 'relative',
            width: '100%',
            aspectRatio: `${w} / ${h}`,
            background: '#fff',
            color: '#000',
            fontFamily: FORM_FONT,
            overflow: 'hidden',
            WebkitPrintColorAdjust: 'exact',
            printColorAdjust: 'exact',
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

/** Garis horizontal dari x1 ke x2 pada y (t = tebal). Digambar sebagai kotak berlatar (bukan
 * border) supaya tebalnya tidak dibulatkan ke piksel utuh; `print-color-adjust: exact` di
 * FormSheet memastikan latar ikut tercetak. */
export function HLine({ x1, x2, y, t = 2, dotted = false }: { x1: number; x2: number; y: number; t?: number; dotted?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: px(x1),
        top: `calc(${py(y)} - ${thick(t)} / 2)`,
        width: u(x2 - x1),
        height: thick(t),
        background: dotted ? `radial-gradient(circle at 50% 50%, #000 40%, transparent 45%) 0 0 / ${u(4)} 100% repeat-x` : '#000',
      }}
    />
  );
}

/** Garis vertikal pada x dari y1 ke y2. */
export function VLine({ x, y1, y2, t = 2 }: { x: number; y1: number; y2: number; t?: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `calc(${px(x)} - ${thick(t)} / 2)`,
        top: py(y1),
        width: thick(t),
        height: u(y2 - y1),
        background: '#000',
      }}
    />
  );
}

/** Teks dalam kotak (x, y, w, h) dengan ukuran huruf `size` (satuan gambar asli). */
export function Txt({
  x,
  y,
  w,
  h,
  size,
  bold = false,
  align = 'left',
  valign = 'center',
  spacing = 0,
  lineHeight,
  pad = 0,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'center' | 'bottom';
  spacing?: number;
  lineHeight?: number;
  pad?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: px(x),
        top: py(y),
        width: u(w),
        height: u(h),
        display: 'flex',
        alignItems: valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center',
        justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        textAlign: align,
        fontSize: u(size),
        fontWeight: bold ? 700 : 400,
        letterSpacing: spacing ? u(spacing) : undefined,
        lineHeight: lineHeight ? u(lineHeight) : 1.12,
        paddingLeft: align === 'left' ? u(pad) : 0,
        paddingRight: align === 'right' ? u(pad) : 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <div>{children}</div>
    </div>
  );
}

/** Kotak kosong pada posisi (x, y, w, h) untuk menaruh elemen bebas (mis. logo). */
export function Box({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: React.ReactNode }) {
  return <div style={{ position: 'absolute', left: px(x), top: py(y), width: u(w), height: u(h) }}>{children}</div>;
}
