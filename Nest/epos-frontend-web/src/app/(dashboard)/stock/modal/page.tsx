'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { formatDate, formatRupiah } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CostDialog, type CostRow } from './cost-dialog';

// Admin saja (lihat proxy.ts & @Roles di StockController): harga modal batch
// yang belum diisi gudang, dan koreksi yang salah ketik.
function ModalBarang() {
  const params = useSearchParams();
  const refId = params.get('refId');
  const [tab, setTab] = React.useState(params.get('tab') === 'semua' ? 'semua' : 'pending');
  const [editing, setEditing] = React.useState<CostRow | null>(null);

  const query = new URLSearchParams({ filter: tab === 'semua' ? 'all' : 'pending' });
  if (refId) query.set('refId', refId);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['stock-costs', query.toString()],
    queryFn: () => apiClient.get<CostRow[]>(`/stock/costs?${query.toString()}`),
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Modal Barang</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Isi harga modal barang yang diterima tanpa nota, atau perbaiki yang salah ketik.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending">Belum Diisi</TabsTrigger>
            <TabsTrigger value="semua">Semua Batch</TabsTrigger>
          </TabsList>
        </Tabs>
        {refId && (
          <Button asChild variant="outline" size="sm">
            <Link href="/stock/modal">
              Tampilkan semua barang
            </Link>
          </Button>
        )}
      </div>

      {isError ? (
        <p className="text-sm text-destructive">Gagal memuat data modal.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">
          {tab === 'pending' ? 'Semua modal sudah diisi.' : 'Belum ada batch.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Diterima</TableHead>
              <TableHead>Barang</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              <TableHead>Pemasok</TableHead>
              <TableHead>Dicatat oleh</TableHead>
              <TableHead className="text-right">Modal</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.itemCostIds[0]}>
                <TableCell className="text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                <TableCell>
                  {row.name}
                  {row.itemCostIds.length > 1 && (
                    <span className="ml-1 text-xs text-muted-foreground">({row.itemCostIds.length} gulungan)</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.qtyReceived === null ? '-' : `${row.qtyReceived} ${row.unit}`}
                </TableCell>
                <TableCell className="text-muted-foreground">{row.supplierName || '-'}</TableCell>
                <TableCell className="text-muted-foreground">{row.createdByName || '-'}</TableCell>
                <TableCell className="text-right">
                  {row.buyPrice === null ? <Badge variant="secondary">Belum diisi</Badge> : formatRupiah(row.buyPrice)}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                    {row.buyPrice === null ? 'Isi modal' : 'Ubah modal'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing && <CostDialog row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export default function ModalBarangPage() {
  return (
    <React.Suspense fallback={null}>
      <ModalBarang />
    </React.Suspense>
  );
}
