'use client';

import * as React from 'react';

import { UnitLabelCard, type UnitLabelUnit } from '@/components/unit-label-card';
import { Button } from '@/components/ui/button';

// Lembar cetak banyak label unit AC dengan pengaturan kertas dan jumlah kolom. Stikernya tetap UnitLabelCard (rancangan
// 97 x 62 mm); jumlah kolom menentukan lebar tiap label, lalu stiker diskalakan proporsional: kolom lebih sedikit =
// label lebih besar di kertas yang sama.

export type PaperKey = 'A4' | 'A5' | 'A6';
export const PAPERS: Record<PaperKey, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  A6: { w: 105, h: 148 },
};
export const COLUMN_OPTIONS = [1, 2, 3, 4] as const;

const MARGIN_MM = 8;
const GAP_MM = 2;
// Ukuran rancangan stiker (UnitLabelCard) dan QR di dalamnya (104px = 27,5 mm).
const REF_W_MM = 97;
const REF_H_MM = 62;
const QR_REF_MM = (104 * 25.4) / 96;
// Di bawah ini QR di kertas biasa mulai susah discan.
export const MIN_QR_MM = 15;

export interface SheetLayout {
  paperW: number;
  paperH: number;
  usableW: number;
  usableH: number;
  cellW: number;
  cellH: number;
  scale: number;
  rows: number;
  perPage: number;
  qrMm: number;
}

export function computeSheetLayout(paper: PaperKey, cols: number): SheetLayout {
  const p = PAPERS[paper];
  const usableW = p.w - 2 * MARGIN_MM;
  const usableH = p.h - 2 * MARGIN_MM;
  const cellW = (usableW - GAP_MM * (cols - 1)) / cols;
  const scale = cellW / REF_W_MM;
  const cellH = REF_H_MM * scale;
  const rows = Math.max(1, Math.floor((usableH + GAP_MM) / (cellH + GAP_MM)));
  return {
    paperW: p.w,
    paperH: p.h,
    usableW,
    usableH,
    cellW,
    cellH,
    scale,
    rows,
    perPage: rows * cols,
    qrMm: QR_REF_MM * scale,
  };
}

const STORAGE_KEY = 'epos.unitLabelSheet';

function readStored(): { paper: PaperKey; cols: number } {
  const fallback = { paper: 'A4' as PaperKey, cols: 2 };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as { paper?: string; cols?: number };
    return {
      paper: v.paper && v.paper in PAPERS ? (v.paper as PaperKey) : fallback.paper,
      cols: v.cols && (COLUMN_OPTIONS as readonly number[]).includes(v.cols) ? v.cols : fallback.cols,
    };
  } catch {
    return fallback; // storage tidak tersedia/rusak: pakai bawaan
  }
}

/**
 * Pilihan kertas + kolom, diingat per browser (opsional: gagal baca/tulis storage tidak mengganggu). Dibaca saat state
 * dibuat; dipakai hanya setelah data label termuat di klien, jadi tidak memengaruhi HTML dari server.
 */
export function useLabelSheetSettings() {
  const [paper, setPaper] = React.useState<PaperKey>(() => readStored().paper);
  const [cols, setCols] = React.useState<number>(() => readStored().cols);

  const save = (p: PaperKey, c: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ paper: p, cols: c }));
    } catch {
      /* abaikan */
    }
  };
  return {
    paper,
    cols,
    setPaper: (p: PaperKey) => {
      setPaper(p);
      save(p, cols);
    },
    setCols: (c: number) => {
      setCols(c);
      save(paper, c);
    },
  };
}

const mm = (n: number) => `${Math.round(n * 10) / 10}`.replace('.', ',');

/** Panel pengaturan (tidak ikut tercetak). */
export function LabelSheetSettings({
  paper,
  cols,
  onPaper,
  onCols,
  total,
}: {
  paper: PaperKey;
  cols: number;
  onPaper: (p: PaperKey) => void;
  onCols: (c: number) => void;
  total: number;
}) {
  const L = computeSheetLayout(paper, cols);
  const pages = Math.max(1, Math.ceil(total / L.perPage));
  return (
    <div className="mb-4 grid gap-3 rounded-md border p-3 print:hidden">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Kertas</span>
          {(Object.keys(PAPERS) as PaperKey[]).map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={paper === k ? 'default' : 'outline'}
              aria-pressed={paper === k}
              onClick={() => onPaper(k)}
            >
              {k}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Label per baris</span>
          {COLUMN_OPTIONS.map((c) => (
            <Button
              key={c}
              type="button"
              size="sm"
              variant={cols === c ? 'default' : 'outline'}
              aria-pressed={cols === c}
              onClick={() => onCols(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {total} label · {pages} halaman {paper} ({L.rows} baris × {cols} kolom = {L.perPage} label per halaman) · ukuran
        tiap label ± {mm(L.cellW)} × {mm(L.cellH)} mm, QR ± {mm(L.qrMm)} mm. Kolom lebih sedikit = label lebih besar. Saat
        mencetak, pilih ukuran kertas yang sama dan skala 100% (tanpa &quot;Fit to page&quot;).
      </p>
      {L.qrMm < MIN_QR_MM && (
        <p className="text-xs font-medium text-status-warning-foreground dark:text-status-warning">
          QR terlalu kecil (di bawah {MIN_QR_MM} mm), hasil cetak bisa susah discan. Kurangi jumlah kolom atau pakai
          kertas yang lebih besar.
        </p>
      )}
    </div>
  );
}

export interface SheetItem {
  key: string;
  unit: UnitLabelUnit;
  memberName?: string | null;
  memberAddress?: string | null;
}

/** Halaman-halaman label sesuai pengaturan. Satu halaman = satu `div` (dipecah per halaman cetak). */
export function UnitLabelSheet({ items, paper, cols }: { items: SheetItem[]; paper: PaperKey; cols: number }) {
  const L = computeSheetLayout(paper, cols);
  const pages: SheetItem[][] = [];
  for (let i = 0; i < items.length; i += L.perPage) pages.push(items.slice(i, i + L.perPage));

  return (
    <div className="overflow-x-auto">
      <style>{`@page { size: ${L.paperW}mm ${L.paperH}mm; margin: ${MARGIN_MM}mm; }`}</style>
      {pages.map((chunk, pi) => (
        <div
          key={pi}
          className="mb-4 border border-dashed border-muted-foreground/30 bg-white text-black print:mb-0 print:border-0"
          style={{
            // content-box: garis tepi pratinjau di layar tidak boleh memakan lebar isi (kolom terakhir terpotong).
            boxSizing: 'content-box',
            width: `${L.usableW}mm`,
            height: `${L.usableH - 0.5}mm`,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, ${L.cellW}mm)`,
            gridAutoRows: `${L.cellH}mm`,
            gap: `${GAP_MM}mm`,
            alignContent: 'start',
            overflow: 'hidden',
            breakAfter: pi < pages.length - 1 ? 'page' : undefined,
          }}
        >
          {chunk.map((it) => (
            <div key={it.key} style={{ width: `${L.cellW}mm`, height: `${L.cellH}mm`, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${REF_W_MM}mm`,
                  height: `${REF_H_MM}mm`,
                  transform: `scale(${L.scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <UnitLabelCard unit={it.unit} memberName={it.memberName} memberAddress={it.memberAddress} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
