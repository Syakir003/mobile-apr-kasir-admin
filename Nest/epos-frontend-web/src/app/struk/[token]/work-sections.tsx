import * as React from 'react';

// Bagian halaman struk publik di luar kertas nota: status pengerjaan + galeri foto sebelum/sesudah.
// Server Component murni (tanpa state); data dari GET /public/receipt/:token -> `work`.
export interface PublicWork {
  progress: number; // 0-100
  label: string; // 'Selesai' | 'Sedang dikerjakan' | 'Belum dimulai'
  done: boolean;
  gallery: { id: string; title: string; unit: string | null; before: string[]; after: string[] }[];
}

function ProgressRing({ value, done }: { value: number; done: boolean }) {
  const color = done ? '#16a34a' : '#d97706';
  return (
    <div
      role="img"
      aria-label={`Progres pengerjaan ${value} persen`}
      className="grid size-16 shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(${color} ${value * 3.6}deg, #e5e7eb 0deg)` }}
    >
      <div className="grid size-[3.1rem] place-items-center rounded-full bg-white text-sm font-semibold text-gray-900">
        {value}%
      </div>
    </div>
  );
}

export function WorkStatusCard({ work }: { work: PublicWork }) {
  const dot = work.done ? 'bg-green-500' : work.progress > 10 ? 'bg-amber-500' : 'bg-gray-400';
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Status Pengerjaan</h2>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-gray-600">
            <span className={`size-2.5 rounded-full ${dot}`} aria-hidden />
            {work.label}
          </p>
        </div>
        <ProgressRing value={work.progress} done={work.done} />
      </div>
    </section>
  );
}

function PhotoColumn({ label, ids, token }: { label: string; ids: string[]; token: string }) {
  return (
    <div className="grid content-start gap-2">
      <p className="text-[11px] font-medium tracking-wide text-gray-500 uppercase">{label}</p>
      {ids.length === 0 && (
        <div className="grid aspect-[4/3] place-items-center rounded-lg border border-dashed border-gray-300 text-[11px] text-gray-400">
          Belum ada foto
        </div>
      )}
      {ids.map((id, i) => (
        <a
          key={id}
          href={`/struk/${token}/foto/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-lg bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-900"
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
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Galeri Hasil Pengerjaan</h2>
      <p className="mt-0.5 text-xs text-gray-500">Ketuk foto untuk memperbesar.</p>
      <div className="mt-4 grid gap-5 divide-y divide-gray-100">
        {gallery.map((g) => (
          <article key={g.id} className="grid gap-3 pt-5 first:pt-0">
            <div>
              <p className="text-sm font-medium text-gray-900">{g.title}</p>
              {g.unit && <p className="text-xs text-gray-500">{g.unit}</p>}
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
