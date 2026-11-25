import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';

// Bagian halaman struk publik di luar kertas nota: status pengerjaan + galeri foto sebelum/sesudah.
// Server Component murni (tanpa state); data dari GET /public/receipt/:token -> `work`.
export interface PublicWork {
  progress: number; // 0-100
  label: string; // 'Selesai' | 'Sedang dikerjakan' | 'Belum dimulai'
  done: boolean;
  gallery: { id: string; title: string; unit: string | null; before: string[]; after: string[] }[];
}

// Status pengerjaan ditampilkan sebagai teks + penanda, BUKAN cincin persen: nota baru dikirim setelah pekerjaan beres,
// sehingga nilainya selalu 100% (keputusan produk). Cincin yang tidak pernah berubah hanya angka dekoratif. Warna dari
// token tema (bukan abu-abu/hex mentah) supaya halaman ini senada dengan aplikasi.
export function WorkStatusCard({ work }: { work: PublicWork }) {
  return (
    <section className="rounded-2xl bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">Status Pengerjaan</h2>
      <p className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
        {work.done ? (
          <CheckCircle2 className="size-4 text-status-success" aria-hidden />
        ) : (
          <span
            className={`size-2.5 rounded-full ${work.progress > 10 ? 'bg-status-warning' : 'bg-muted-foreground'}`}
            aria-hidden
          />
        )}
        {work.label}
      </p>
    </section>
  );
}

function PhotoColumn({ label, ids, token }: { label: string; ids: string[]; token: string }) {
  return (
    <div className="grid content-start gap-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {ids.length === 0 && (
        <div className="grid aspect-[4/3] place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
          Belum ada foto
        </div>
      )}
      {ids.map((id, i) => (
        <a
          key={id}
          href={`/struk/${token}/foto/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-lg bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/struk/${token}/foto/${id}`}
            alt={`Foto ${label.toLowerCase()} pengerjaan ${i + 1}`}
            loading="lazy"
            className="aspect-[4/3] w-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}

export function WorkGallery({ token, gallery }: { token: string; gallery: PublicWork['gallery'] }) {
  if (gallery.length === 0) return null;
  return (
    <section className="rounded-2xl bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">Galeri Hasil Pengerjaan</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Ketuk foto untuk memperbesar.</p>
      <div className="mt-4 grid gap-5 divide-y divide-border">
        {gallery.map((g) => (
          <article key={g.id} className="grid gap-3 pt-5 first:pt-0">
            <div>
              <p className="text-sm font-medium text-foreground">{g.title}</p>
              {g.unit && <p className="text-xs text-muted-foreground">{g.unit}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <PhotoColumn label="Sebelum" ids={g.before} token={token} />
              <PhotoColumn label="Sesudah" ids={g.after} token={token} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
