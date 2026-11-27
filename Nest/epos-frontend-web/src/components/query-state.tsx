import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Keadaan "memuat" dan "gagal" yang memberi tahu penyebab dan langkah berikutnya (R-27), bukan teks polos.
 * Dipakai halaman job, kartu Harga Jasa, dan halaman cetak Laporan Pekerjaan.
 */

/** Kerangka pengisi saat data dimuat. `label` dibacakan pembaca layar; animasi berhenti bila reduced-motion. */
export function LoadingBlock({ label, rows = 3, className }: { label: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('grid gap-3', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            'h-5 animate-pulse rounded bg-muted motion-reduce:animate-none',
            i === 0 ? 'w-2/5' : i % 2 ? 'w-full' : 'w-4/5',
          )}
        />
      ))}
    </div>
  );
}

/**
 * Kegagalan memuat: apa yang gagal, apa yang bisa dilakukan, dan tombol Coba lagi / Kembali. Latar kartu putih
 * (bukan tint merah) supaya teks merah tetap lulus kontras AA.
 */
export function ErrorBlock({
  title,
  detail,
  onRetry,
  backHref,
  backLabel,
  className,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('grid gap-3 rounded-md border border-destructive/40 bg-card p-4 text-sm', className)}>
      <div className="grid gap-1">
        <p className="font-medium text-destructive">{title}</p>
        <p className="text-muted-foreground">{detail}</p>
      </div>
      {(onRetry || backHref) && (
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              Coba lagi
            </Button>
          )}
          {backHref && (
            <Button asChild size="sm" variant="ghost">
              <Link href={backHref}>{backLabel ?? 'Kembali'}</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
