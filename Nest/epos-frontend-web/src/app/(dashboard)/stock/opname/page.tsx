'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OpnameTab } from './opname-tab';
import { RiwayatTab } from './riwayat-tab';

// Koreksi stok fisik (opname) + histori mutasi stok — 2 fitur beda tapi
// sama-sama "audit stok", ditaruh 1 halaman biar admin gak perlu loncat
// menu buat cross-check angka opname vs riwayatnya. Endpoint StockController
// admin-only, sama kayak halaman Barang Masuk (/stock).
export default function StockOpnamePage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Opname & Riwayat Stok</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Koreksi stok fisik produk/sparepart, dan lihat histori mutasi stok.
        </p>
      </div>

      <Tabs defaultValue="opname">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="opname">Opname</TabsTrigger>
          <TabsTrigger value="riwayat">Riwayat</TabsTrigger>
        </TabsList>
        <TabsContent value="opname" className="mt-4">
          <OpnameTab />
        </TabsContent>
        <TabsContent value="riwayat" className="mt-4">
          <RiwayatTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
