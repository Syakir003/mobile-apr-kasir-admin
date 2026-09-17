'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatDateTime, formatRupiah, statusLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { PrintMenu } from '@/components/print-menu';

// Semua transaksi POS (bukan cuma punya 1 member kayak /members/[id]) —
// bisa dicari nomor/nama/HP, difilter status & rentang tanggal, dan
// paginated. Padanan InvoicesService.findAll() yang baru (page/pageSize
// sama pola dengan TechnicianJobsService.history()).
const STATUS_OPTIONS = [
  { value: 'belum_dibayar', label: 'Belum Dibayar' },
  { value: 'dp', label: 'DP' },
  { value: 'kurang_bayar', label: 'Kurang Bayar' },
  { value: 'lunas', label: 'Lunas' },
  { value: 'refund', label: 'Refund' },
  { value: 'batal', label: 'Batal' },
];

function invoiceStatusVariant(status: string): 'success' | 'warning' | 'secondary' {
  if (status === 'lunas') return 'success';
  if (status === 'batal' || status === 'refund') return 'secondary';
  return 'warning';
}

interface InvoiceRow {
  id: string;
  number: string;
  customerName: string | null;
  customerPhone: string | null;
  grandTotal: string;
  status: string;
  createdAt: string;
  member: { id: string; name: string } | null;
  // Ada isinya cuma kalau invoice ini lahir dari servis/instalasi (checkout
  // yang bikin ServiceOrder) — dipakai buat nentuin pilihan cetak Surat
  // Jalan/Label Unit relevan atau enggak buat baris ini.
  serviceOrders: { id: string; _count: { serviceOrderUnits: number } }[];
}
interface InvoicePage {
  items: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function InvoicesPage() {
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [status, setStatus] = React.useState<string>('all');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Filter apa pun berubah -> balik ke halaman 1, biar gak nyangkut di
  // halaman yang udah gak ada hasilnya.
  React.useEffect(() => {
    setPage(1);
  }, [debounced, status, from, to]);

  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (debounced) params.set('q', debounced);
  if (status !== 'all') params.set('status', status);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', debounced, status, from, to, page],
    queryFn: () => apiClient.get<InvoicePage>(`/invoices?${params.toString()}`),
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Riwayat Transaksi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Semua invoice dari transaksi POS — cari, filter, atau cetak ulang.
        </p>
      </div>

      {/* Tiap kolom filter dikasih Label yang sama tingginya (termasuk yang
          search/status, walau labelnya gak "penting" secara isi) — biar
          input-nya semua rata sejajar satu baris, gak jaggy kayak
          sebelumnya (search & status gak ada label, jadi lebih naik ke atas
          dibanding Dari/Sampai Tanggal yang ada label-nya). */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="q" className="text-xs text-muted-foreground">
            Cari
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="q"
              placeholder="No. invoice, nama, HP..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="status" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="status" className="w-full">
              <SelectValue placeholder="Semua Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
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

      {isLoading && <p className="text-sm text-muted-foreground">Memuat transaksi...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat riwayat transaksi.</p>}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada transaksi yang cocok.</p>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Invoice</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                  >
                    <TableCell className="font-medium">{inv.number}</TableCell>
                    <TableCell
                      className="text-muted-foreground"
                      onClick={(e) => inv.member && e.stopPropagation()}
                    >
                      {inv.member ? (
                        <Link
                          href={`/members/${inv.member.id}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {inv.customerName || inv.member.name}
                        </Link>
                      ) : (
                        inv.customerName || '-'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(inv.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">{formatRupiah(inv.grandTotal)}</TableCell>
                    <TableCell>
                      <Badge variant={invoiceStatusVariant(inv.status)}>
                        {statusLabel(inv.status)}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <PrintMenu invoiceId={inv.id} serviceOrders={inv.serviceOrders} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Halaman {data.page} dari {data.totalPages} ({data.total} transaksi)
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
    </div>
  );
}

