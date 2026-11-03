import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReceiptView, type ReceiptData } from '@/components/receipt-view';
import { WorkGallery, WorkStatusCard, type PublicWork } from './work-sections';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Halaman publik untuk pelanggan (tautan dari WhatsApp), TANPA login — lihat PUBLIC_PATHS di proxy.ts.
// Pelindungnya token acak di URL; jangan diindeks mesin pencari dan jangan bocor lewat Referer.
export const metadata: Metadata = {
  title: 'Struk Pembelian',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function StrukPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await fetch(`${BACKEND_URL}/public/receipt/${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error('Gagal memuat struk');
  const { work, ...data } = (await res.json()) as ReceiptData & { work: PublicWork | null };

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6">
      <div className="mx-auto flex w-full max-w-[18.2rem] flex-col gap-4">
        {/* Logo toko berwarna di atas nota (kertas nota sendiri tanpa logo hitam-putih supaya tidak dobel). */}
        <header className="flex justify-center pt-1 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-apr-hd.png" alt="Ayub AC" className="h-auto w-32" />
        </header>

        <ReceiptView data={data} zoom={1.6} showLogo={false} />

        {/* Hanya untuk nota yang punya pekerjaan teknisi (servis/pemasangan); penjualan biasa cukup nota. */}
        {work && <WorkStatusCard work={work} />}
        {work && <WorkGallery token={token} gallery={work.gallery} />}
      </div>
    </main>
  );
}
