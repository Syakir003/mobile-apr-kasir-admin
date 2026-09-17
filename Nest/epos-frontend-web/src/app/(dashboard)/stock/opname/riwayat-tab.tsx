'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Log histori semua mutasi stok (barang masuk, penjualan, opname, pemakaian
// servis/instalasi, dst) dari tabel stock_movements — read-only, cuma
// filter + tabel. Endpoint /stock/movements gak ada pagination, backend
// selalu balikin array langsung dibatasi 200 baris terbaru, jadi TIDAK ADA
// kontrol next/prev page di sini (beda sama pola InvoicesPage).
const REASON_OPTIONS = [
  { value: 'penjualan', label: 'Penjualan' },
  { value: 'pemakaian_instalasi', label: 'Pemakaian Instalasi' },
  { value: 'barang_masuk', label: 'Barang Masuk' },
  { value: 'opname', label: 'Opname' },
  { value: 'pembatalan_job', label: 'Pembatalan Job' },
  { value: 'pengajuan_tambahan', label: 'Pengajuan Material' },
  { value: 'pemakaian_servis', label: 'Pemakaian Servis' },
];

const REASON_LABELS: Record<string, string> = {
  penjualan: 'Penjualan',
  pemakaian_instalasi: 'Pemakaian Instalasi',
  barang_masuk: 'Barang Masuk',
  opname: 'Opname',
  pembatalan_job: 'Pembatalan Job',
  pengajuan_tambahan: 'Pengajuan Material',
  pemakaian_servis: 'Pemakaian Servis',
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

interface StockMovement {
  id: string;
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  qtyChange: string;
  reason: string;
  transactionId: string | null;
  itemCostId: string | null;
  createdById: string;
  createdAt: string;
}

export function RiwayatTab() {
  const [itemKind, setItemKind] = React.useState<string>('all');
  const [reason, setReason] = React.useState<string>('all');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  const params = new URLSearchParams();
  if (itemKind !== 'all') params.set('itemKind', itemKind);
  if (reason !== 'all') params.set('reason', reason);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['stock-movements', itemKind, reason, from, to],
    queryFn: () => apiClient.get<StockMovement[]>(`/stock/movements?${params.toString()}`),
  });

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="itemKind" className="text-xs text-muted-foreground">
            Jenis
          </Label>
          <Select value={itemKind} onValueChange={setItemKind}>
            <SelectTrigger id="itemKind" className="w-full">
              <SelectValue placeholder="Semua Jenis" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Jenis</SelectItem>
              <SelectItem value="product">Produk</SelectItem>
              <SelectItem value="sparepart">Sparepart</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reason" className="text-xs text-muted-foreground">
            Alasan
          </Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger id="reason" className="w-full">
              <SelectValue placeholder="Semua Alasan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Alasan</SelectItem>
              {REASON_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="from" className="text-xs text-muted-foreground">
            Dari Tanggal
          </Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="to" className="text-xs text-muted-foreground">
            Sampai Tanggal
          </Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Memuat riwayat stok...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat riwayat stok.</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada mutasi yang cocok.</p>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-2">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Alasan</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((m) => {
                  const qty = Number(m.qtyChange);
                  const isPositive = qty >= 0;
                  const sign = m.qtyChange.trim().startsWith('-') ? '' : isPositive ? '+' : '';
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.itemKind === 'product' ? 'secondary' : 'outline'}>
                          {m.itemKind === 'product' ? 'Produk' : 'Sparepart'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{reasonLabel(m.reason)}</Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          isPositive ? 'text-status-success' : 'text-destructive'
                        }`}
                      >
                        {sign}
                        {m.qtyChange}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Menampilkan maksimal 200 mutasi terbaru.
          </p>
        </div>
      )}
    </div>
  );
}
