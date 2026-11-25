'use client';

import * as React from 'react';
import Link from 'next/link';
import { UnitPartsList, type UnitPartProduct } from '@/components/ac-unit-parts';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Pencil, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate, formatRupiah, statusLabel } from '@/lib/format';
import { TIER_LABEL, TIER_OPTIONS, type PriceTier } from '@/lib/price-tier';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardAction, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DeleteUnitsDialog } from '@/components/delete-units-dialog';
import { EditMemberDialog } from './edit-member-dialog';
import {
  LocationsCard,
  MoveUnitsBar,
  MoveUnitsDialog,
  unitLocationName,
  type MemberLocationRow,
} from './member-locations';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorBlock, LoadingBlock } from '@/components/query-state';

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
  indoorProduct?: UnitPartProduct | null;
  outdoorProduct?: UnitPartProduct | null;
  status: string;
  installationDate: string | null;
  lastServiceDate: string | null;
  // Lokasi unit (member multi lokasi); null = Lokasi 1 (alamat utama).
  locationId?: string | null;
  location?: { id: string; name: string } | null;
}
interface MemberDetail {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  mapsUrl?: string | null;
  customerType: string | null;
  priceTier: PriceTier;
  memberSince: string | null;
  notes: string | null;
  active: boolean;
  waOptOut: boolean;
  // Multi lokasi: Lokasi 1 = alamat utama (mainLocationName = namanya), lokasi lain di `locations`.
  multiLocation: boolean;
  mainLocationName: string | null;
  locations: MemberLocationRow[];
  acUnits: MemberAcUnitRow[];
  invoices: MemberInvoice[];
}

function invoiceStatusVariant(status: string): 'success' | 'warning' {
  return status === 'lunas' ? 'success' : 'warning';
}

function unitStatusVariant(status: string): 'success' | 'secondary' | 'warning' {
  if (status === 'aktif') return 'success';
  if (status === 'menunggu_pemasangan' || status === 'menunggu_data') return 'warning';
  return 'secondary';
}

export function MemberDetailClient({
  memberId,
  canEditTier,
  canEdit,
  canDelete = false,
}: {
  memberId: string;
  canEditTier: boolean;
  // Ubah data member (nama, HP, alamat, link Maps, dst.): admin & kasir, sama dengan PATCH /members/:id.
  canEdit: boolean;
  // Hapus unit AC member yang tidak jadi dipakai: admin saja (POST /ac-units/delete).
  canDelete?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);
  // Unit AC yang dicentang untuk dipindah ke lokasi lain (hanya member multi lokasi).
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // Hapus unit yang dicentang (admin): dialog konfirmasi + hasil.
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  // Lokasi baru yang baru dibuat dari dialog Ubah Member: menawarkan memindahkan unit ke lokasi itu (id lokasi tujuan).
  const [moveOffer, setMoveOffer] = React.useState<string | null>(null);

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

  const tierMutation = useMutation({
    mutationFn: (priceTier: PriceTier) =>
      apiClient.patch(`/members/${memberId}/price-tier`, { priceTier }),
    onSuccess: (_res, priceTier) => {
      toast.success(`Tipe pembeli diubah ke ${TIER_LABEL[priceTier]}.`);
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['members-pick'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengubah tipe pembeli.');
    },
  });

  if (isLoading) return <LoadingBlock label="Memuat member" />;
  if (isError || !data) {
    return <ErrorBlock title="Gagal memuat data member" detail="Periksa koneksi internet, lalu muat ulang halaman." />;
  }

  // Pilih beberapa unit untuk dipindah lokasi: hanya member multi lokasi, dan hanya yang boleh mengubah data member.
  // Admin selalu bisa mencentang unit (untuk Hapus); kasir hanya untuk Pindahkan pada member multi lokasi.
  const showSelect = canDelete || (canEdit && data.multiLocation);
  const allSelected = data.acUnits.length > 0 && data.acUnits.every((u) => selected.has(u.id));

  return (
    <div className="grid gap-6">
      {canEdit && (
        <EditMemberDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          member={data}
          onSaved={(createdIds) => {
            if (createdIds.length > 0) setMoveOffer(createdIds[0]);
          }}
        />
      )}
      {canDelete && deleteOpen && selected.size > 0 && (
        <DeleteUnitsDialog
          unitIds={[...selected]}
          onClose={() => setDeleteOpen(false)}
          onDone={() => setSelected(new Set())}
        />
      )}
      {canEdit && moveOffer && data.multiLocation && data.acUnits.length > 0 && (
        <MoveUnitsDialog
          member={data}
          units={data.acUnits}
          initialTarget={moveOffer}
          onClose={() => setMoveOffer(null)}
        />
      )}
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
          {data.priceTier !== 'retail' && <Badge variant="secondary">{TIER_LABEL[data.priceTier]}</Badge>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        {/* Tiap section: panel dengan pita judul abu-abu dan bayangan tipis, supaya terpisah dari latar halaman. */}
        <Card className="h-fit gap-0 overflow-hidden py-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/60 py-3">
            <CardTitle className="text-base">Data Member</CardTitle>
            {canEdit && (
              <Button variant="ghost" size="icon" title="Edit" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid gap-2 py-5 text-sm">
            <DetailRow label="No. HP" value={data.phone || '-'} />
            <DetailRow label="Alamat" value={data.address || '-'} />
            <DetailRow
              label="Lokasi Maps"
              value={data.mapsUrl || '-'}
              valueNode={
                data.mapsUrl ? (
                  <a href={data.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Buka di Maps
                  </a>
                ) : undefined
              }
            />
            <DetailRow label="Tipe" value={data.customerType || '-'} />
            {/* Tipe pembeli (2026-10-13) — menentukan harga & hak beli di POS.
                Berlaku ke transaksi berikutnya; invoice lama tidak berubah. */}
            {canEditTier ? (
              <div className="grid gap-1.5 border-t pt-3">
                <span className="text-muted-foreground">Tipe Pembeli</span>
                <Select
                  value={data.priceTier}
                  disabled={tierMutation.isPending}
                  onValueChange={(v) => tierMutation.mutate(v as PriceTier)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  Menentukan harga di kasir. Installer dan Reseller hanya bisa membeli AC dan Sparepart.
                </span>
              </div>
            ) : (
              <DetailRow label="Tipe Pembeli" value={TIER_LABEL[data.priceTier]} />
            )}
            <DetailRow
              label="Member Sejak"
              value={data.memberSince ? formatDate(data.memberSince) : '-'}
            />
            {data.multiLocation && (
              <DetailRow label="Multi Lokasi" value={`Aktif (${1 + data.locations.length} lokasi)`} />
            )}
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
                  Invoice tetap bisa dikirim manual - ini cuma nyetop pengingat servis otomatis.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          {data.multiLocation && <LocationsCard member={data} canEdit={canEdit} />}
          <Card className="gap-0 overflow-hidden py-0 shadow-sm">
            <CardHeader className="border-b bg-muted/60 py-4">
              <CardTitle className="flex items-center gap-2 text-base">
                Unit AC
                <Badge variant="secondary">{data.acUnits.length}</Badge>
              </CardTitle>
              <CardDescription>
                Unit yang tercatat atas nama member ini - klik untuk lihat riwayat servisnya.
              </CardDescription>
              {/* Cetak label QR semua unit member sekaligus (member lama yang unitnya belum pernah di-scan). Halaman
                  cetaknya sama dengan Data Lampau; maksimal 100 label sekali cetak. */}
              {canEdit && data.acUnits.length > 0 && (
                <CardAction>
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/administrasi/data-lampau/cetak?ids=${encodeURIComponent(
                        data.acUnits
                          .slice(0, 100)
                          .map((u) => u.id)
                          .join(','),
                      )}`}
                    >
                      <Printer className="size-4" />
                      Cetak Label Semua Unit
                    </Link>
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="py-5">
              {data.acUnits.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada unit AC tercatat.</p>
              )}
              {showSelect && selected.size > 0 && (
                <div className="mb-3 grid gap-2">
                  {canEdit && data.multiLocation && (
                    <MoveUnitsBar member={data} selectedIds={[...selected]} onMoved={() => setSelected(new Set())} />
                  )}
                  {canDelete && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm">
                      <span className="font-medium">{selected.size} unit dipilih</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteOpen(true)}
                      >
                        <Trash2 className="size-4" />
                        Hapus unit
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Unit dengan job aktif atau riwayat servis selesai tidak dihapus.
                      </span>
                    </div>
                  )}
                </div>
              )}
              {data.acUnits.length > 0 && (
                <div className="-mx-5 -mb-5 border-t">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {showSelect && (
                          <TableHead className="w-8">
                            <Checkbox
                              aria-label="Pilih semua unit"
                              checked={allSelected}
                              onCheckedChange={(c) =>
                                setSelected(c === true ? new Set(data.acUnits.map((u) => u.id)) : new Set())
                              }
                            />
                          </TableHead>
                        )}
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
                          {showSelect && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                aria-label="Pilih unit"
                                checked={selected.has(u.id)}
                                onCheckedChange={(c) =>
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    if (c === true) next.add(u.id);
                                    else next.delete(u.id);
                                    return next;
                                  })
                                }
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-medium">
                            <Link
                              href={`/ac-units/${u.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {[u.brand, u.model].filter(Boolean).join(' ') || 'Unit AC'}
                            </Link>
                            <UnitPartsList unit={u} compact emptyText="" />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {[unitLocationName(data, u), u.roomLocation].filter(Boolean).join(' · ') || '-'}
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

          <Card className="gap-0 overflow-hidden py-0 shadow-sm">
            <CardHeader className="border-b bg-muted/60 py-4">
              <CardTitle className="flex items-center gap-2 text-base">
                Riwayat Pembelian
                <Badge variant="secondary">{data.invoices.length}</Badge>
              </CardTitle>
              <CardDescription>
                Semua invoice member ini - unit AC, sparepart, maupun jasa.
              </CardDescription>
            </CardHeader>
            <CardContent className="py-5">
              {data.invoices.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada transaksi.</p>
              )}
              {data.invoices.length > 0 && (
                <div className="-mx-5 -mb-5 divide-y border-t">
                  {data.invoices.map((inv) => (
                    <div key={inv.id} className="px-5 py-3 transition-colors hover:bg-muted/40">
                      <div className="flex flex-wrap items-center justify-between gap-2">
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

function DetailRow({ label, value, valueNode }: { label: string; value: string; valueNode?: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{valueNode ?? value}</span>
    </div>
  );
}
