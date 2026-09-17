'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Eye, Search } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

// Padanan audit_log_screen.dart di app mobile — bedanya, mobile baca
// LANGSUNG dari Supabase (RLS), sedangkan web narik lewat endpoint baru
// GET /audit-logs (AuditLogsModule, admin-only) karena backend NestJS
// sebelum ini cuma NULIS ke audit_logs (tersebar di banyak service lain),
// gak pernah punya cara baca-nya. Filter (page/pageSize/q/group/from/to)
// & paginasi ngikutin pola InvoicesService.findAll/Riwayat Transaksi persis.

// Grup aksi = prefix `action` sebelum titik pertama (mis. 'pos.checkout' ->
// grup 'pos'). Daftar & labelnya di-maintain manual di sini — sama kayak
// `auditActionLabels`/grouping di app mobile — karena backend gak punya satu
// sumber kebenaran buat enumerate semua action yang mungkin ada (lihat
// komentar AuditLogQueryDto di backend).
const GROUP_OPTIONS = [
  { value: 'pos', label: 'Kasir (POS)' },
  { value: 'payment', label: 'Pembayaran' },
  { value: 'stock', label: 'Stok' },
  { value: 'product', label: 'Produk' },
  { value: 'sparepart', label: 'Sparepart' },
  { value: 'service', label: 'Jasa' },
  { value: 'installation_package', label: 'Paket Instalasi' },
  { value: 'voucher', label: 'Voucher' },
  { value: 'service_order', label: 'Order Servis' },
  { value: 'user', label: 'Pengguna' },
];

const ACTION_LABELS: Record<string, string> = {
  'pos.checkout': 'Checkout Transaksi',
  'pos.payment': 'Pembayaran Invoice',
  'stock.in': 'Barang Masuk',
  'stock.opname': 'Opname Stok',
  'product.update': 'Ubah Produk',
  'sparepart.update': 'Ubah Sparepart',
  'service.update': 'Ubah Jasa',
  'installation_package.create': 'Buat Paket Instalasi',
  'installation_package.update': 'Ubah Paket Instalasi',
  'voucher.offer': 'Tawarkan Voucher',
  'service_order.intake': 'Terima Order Servis Mandiri',
  'user.create': 'Buat Akun',
  'user.update': 'Ubah Akun',
  'user.toggle_active': 'Aktif/Nonaktifkan Akun',
  'user.reset_password': 'Reset Password',
  'user.change_password': 'Ganti Password',
};
function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? (action || 'Aktivitas');
}

// Label Indonesia buat kunci di dalam `detail` JSON. Kunci tak dikenal
// diubah dari camelCase jadi kata berspasi (lihat detailLabel) biar tetap
// terbaca tanpa harus dipetakan satu per satu.
const DETAIL_LABELS: Record<string, string> = {
  invoiceId: 'Invoice',
  invoiceNumber: 'No. Invoice',
  transactionId: 'Transaksi',
  memberId: 'Member',
  grandTotal: 'Total',
  totalPaid: 'Sudah Dibayar',
  outstanding: 'Sisa',
  amount: 'Nominal',
  method: 'Metode',
  status: 'Status',
  qtyChange: 'Perubahan Qty',
  reason: 'Alasan',
  role: 'Peran',
  email: 'Email',
  displayName: 'Nama',
  note: 'Catatan',
  itemCount: 'Jumlah Item',
  offered: 'Ditawarkan',
  skipped: 'Dilewati',
  voucherApplied: 'Voucher Dipakai',
  installationPackagesUsed: 'Paket Instalasi Dipakai',
  belowCostOverride: 'Konfirmasi Jual Di Bawah Modal',
};
const MONEY_KEYS = new Set([
  'grandTotal',
  'totalPaid',
  'outstanding',
  'amount',
  'total',
  'subtotal',
  'discount',
  'taxAmount',
  'transportFee',
]);
function detailLabel(key: string): string {
  const known = DETAIL_LABELS[key];
  if (known) return known;
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/(?<=[a-z0-9])([A-Z])/g, ' $1')
    .trim();
  if (!spaced) return key;
  return spaced
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
function detailValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (typeof value === 'number' && MONEY_KEYS.has(key)) return formatRupiah(value);
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
    return value;
  }
  if (Array.isArray(value)) return value.length === 0 ? '-' : JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface AuditLogRow {
  id: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  at: string;
  actor: { displayName: string; email: string };
}
interface AuditLogPage {
  items: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function AuditLogPage() {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [group, setGroup] = React.useState('all');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [detailRow, setDetailRow] = React.useState<AuditLogRow | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
  }, [debounced, group, from, to]);

  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (debounced) params.set('q', debounced);
  if (group !== 'all') params.set('group', group);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', debounced, group, from, to, page],
    queryFn: () => apiClient.get<AuditLogPage>(`/audit-logs?${params.toString()}`),
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Log Audit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Jejak semua aksi penting yang tercatat otomatis — siapa ngelakuin apa, kapan.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="q" className="text-xs text-muted-foreground">
            Cari
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="q"
              placeholder="Aksi, target, nama/email pengguna..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="group" className="text-xs text-muted-foreground">
            Jenis Aksi
          </Label>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger id="group" className="w-full">
              <SelectValue placeholder="Semua Jenis" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Jenis</SelectItem>
              {GROUP_OPTIONS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
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

      {isLoading && <p className="text-sm text-muted-foreground">Memuat log audit...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat log audit.</p>}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada log yang cocok.</p>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Pengguna</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setDetailRow(row)}
                  >
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(row.at)}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{row.actor.displayName}</p>
                      <p className="text-xs text-muted-foreground">{row.actor.email}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{actionLabel(row.action)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.target ? row.target.slice(0, 8) : '-'}
                    </TableCell>
                    <TableCell>
                      <Eye className="size-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Halaman {data.page} dari {data.totalPages} ({data.total} log)
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailRow && actionLabel(detailRow.action)}</DialogTitle>
            <DialogDescription>
              {detailRow && formatDateTime(detailRow.at)} — oleh{' '}
              {detailRow?.actor.displayName}
            </DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="grid gap-2 text-sm">
              {detailRow.target && (
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-muted-foreground">Target</span>
                  <span className="font-mono text-xs">{detailRow.target}</span>
                </div>
              )}
              {detailRow.detail && Object.keys(detailRow.detail).length > 0 ? (
                Object.entries(detailRow.detail).map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-4 py-0.5">
                    <span className="text-muted-foreground">{detailLabel(key)}</span>
                    <span className="text-right break-all">{detailValue(key, value)}</span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">Gak ada detail tambahan.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
