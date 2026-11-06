import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

/**
 * Pita judul untuk panel daftar/tabel: judul + jumlah data, latar abu-abu muda dengan garis di bawahnya.
 * Dipakai di dalam pembungkus `overflow-hidden rounded-xl border bg-card shadow-sm`, sama dengan
 * section di halaman detail (Card `panel`), supaya semua halaman punya bahasa visual yang sama.
 */
export function PanelTitle({ title, count, actions }: { title: string; count?: number; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/60 px-5 py-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {count !== undefined && <Badge variant="secondary">{count}</Badge>}
      {actions && <div className="ml-auto">{actions}</div>}
    </div>
  );
}
