import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReceiptView, type ReceiptData } from '@/components/receipt-view';

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
  const data = (await res.json()) as ReceiptData;

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6">
      <ReceiptView data={data} zoom={1.6} />
    </main>
  );
}
