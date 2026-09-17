import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Titik masuk Master Data — mengelompokkan CRUD Produk/Sparepart/Jasa/Paket
// yang di Flutter masing-masing rute terpisah (/products, /spareparts,
// /services, /master/package) di bawah satu menu nav sesuai NAV_BY_ROLE
// (nav-config.ts). Member & kategori temuan teknisi belum ada di sini —
// menyusul. Voucher SENGAJA gak di sini — itu bukan data acuan statis tapi
// campaign+klaim yang lebih mirip alur transaksi, jadi punya menu top-level
// sendiri (lihat nav-config.ts).
const MASTER_DATA_SECTIONS = [
  {
    href: '/master/produk',
    title: 'Produk AC',
    description: 'Katalog unit AC yang dijual — merek, spesifikasi, harga jual, stok.',
  },
  {
    href: '/master/sparepart',
    title: 'Sparepart',
    description: 'Bahan & komponen servis — freon, pipa, bracket, dsb.',
  },
  {
    href: '/master/jasa',
    title: 'Jasa',
    description: 'Katalog jasa servis/instalasi beserta harga dasarnya.',
  },
  {
    href: '/master/paket',
    title: 'Paket Instalasi',
    description: 'Bundel sparepart & biaya tambahan buat instalasi unit AC.',
  },
];

export default function MasterDataPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Master Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Data acuan yang dipakai POS, servis, dan laporan.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MASTER_DATA_SECTIONS.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <CardTitle className="text-base">{section.title}</CardTitle>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{section.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
