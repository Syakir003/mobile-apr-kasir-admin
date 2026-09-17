'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate, formatRupiah, statusLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface InvoiceItem {
  id: string;
  kind: string;
  name: string;
  qty: string;
  unit: string | null;
  lineTotal: string;
}
interface MemberInvoice {
  id: string;
  number: string;
  grandTotal: string;
  status: string;
  createdAt: string;
  items: InvoiceItem[];
}
interface MemberAcUnitRow {
  id: string;
  brand: string | null;
  model: string | null;
  roomLocation: string | null;
  barcodeValue: string;
  status: string;
  installationDate: string | null;
  lastServiceDate: string | null;
}
interface MemberDetail {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  customerType: string | null;
  memberSince: string | null;
  notes: string | null;
  active: boolean;
  waOptOut: boolean;
  acUnits: MemberAcUnitRow[];
  invoices: MemberInvoice[];
}

function invoiceStatusVariant(status: string): 'success' | 'warning' {
  return status === 'lunas' ? 'success' : 'warning';
}

function unitStatusVariant(status: string): 'success' | 'secondary' | 'warning' {
  if (status === 'aktif') return 'success';
  if (status === 'menunggu_pemasangan') return 'warning';
  return 'secondary';
}

export function MemberDetailClient({ memberId }: { memberId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['members', memberId],
    queryFn: () => apiClient.get<MemberDetail>(`/members/${memberId}`),
  });

  // Siklus WA/Fonnte — "berhenti pengingat WA" TIDAK mematikan tombol "Kirim
  // WA" manual di invoice, cuma nyetop pengingat servis otomatis (H-3/H+7/
  // selesai-servis). Lihat MembersService.setWaOptOut di backend.
  const optOutMutation = useMutation({
    mutationFn: (optOut: boolean) =>
      apiClient.patch(`/members/${memberId}/wa-opt-out`, { optOut }),
    onSuccess: () => {
      toast.success('Preferensi pengingat WA disimpan.');
      queryClient.invalidateQueries({ queryKey: ['members', memberId] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan preferensi.');
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Memuat member...</p>;
  if (isError || !data) {
    return <p className="text-sm text-destructive">Gagal memuat data member.</p>;
  }

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/members"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Kembali ke daftar member
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <Badge variant={data.active ? 'success' : 'secondary'}>
            {data.active ? 'Aktif' : 'Nonaktif'}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Data Member</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <DetailRow label="No. HP" value={data.phone || '-'} />
            <DetailRow label="Alamat" value={data.address || '-'} />
            <DetailRow label="Tipe" value={data.customerType || '-'} />
            <DetailRow
              label="Member Sejak"
              value={data.memberSince ? formatDate(data.memberSince) : '-'}
            />
            <DetailRow label="Jumlah Unit AC" value={String(data.acUnits.length)} />
            <DetailRow label="Jumlah Transaksi" value={String(data.invoices.length)} />
            {data.notes && <DetailRow label="Catatan" value={data.notes} />}

            <label className="mt-2 flex items-start gap-2 border-t pt-3 text-sm">
              <Checkbox
                checked={data.waOptOut}
                disabled={optOutMutation.isPending}
                onCheckedChange={(checked) => optOutMutation.mutate(checked === true)}
              />
              <span>
                Berhenti kirim pengingat WA
                <span className="block text-xs text-muted-foreground">
                  Invoice tetap bisa dikirim manual — ini cuma nyetop pengingat servis otomatis.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Unit AC</CardTitle>
              <CardDescription>
                Unit yang tercatat atas nama member ini — klik untuk lihat riwayat servisnya.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.acUnits.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada unit AC tercatat.</p>
              )}
              {data.acUnits.length > 0 && (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unit</TableHead>
                        <TableHead>Lokasi</TableHead>
                        <TableHead>Barcode</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Servis Terakhir</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.acUnits.map((u) => (
                        <TableRow
                          key={u.id}
                          className="cursor-pointer"
                          onClick={() => router.push(`/ac-units/${u.id}`)}
                        >
                          <TableCell className="font-medium">
                            {[u.brand, u.model].filter(Boolean).join(' ') || '-'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {u.roomLocation || '-'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {u.barcodeValue}
                          </TableCell>
                          <TableCell>
                            <Badge variant={unitStatusVariant(u.status)}>
                              {statusLabel(u.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {u.lastServiceDate ? formatDate(u.lastServiceDate) : '-'}
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Riwayat Pembelian</CardTitle>
              <CardDescription>
                Semua invoice member ini — unit AC, sparepart, maupun jasa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.invoices.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada transaksi.</p>
              )}
              {data.invoices.length > 0 && (
                <div className="grid gap-3">
                  {data.invoices.map((inv) => (
                    <div key={inv.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{inv.number}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(inv.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={invoiceStatusVariant(inv.status)}>
                            {statusLabel(inv.status)}
                          </Badge>
                          <span className="text-sm font-semibold">
                            {formatRupiah(inv.grandTotal)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {inv.items.map((it) => it.name).join(', ') || '-'}
                      </p>
                      <div className="mt-2 flex justify-end">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/invoices/${inv.id}`}>Lihat Invoice</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
