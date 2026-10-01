'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatRupiah, formatDate, statusLabel } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Padanan 3 endpoint ReportsController (admin-only, dijaga proxy.ts di
// prefix /laporan) — /reports/sales, /reports/service, /reports/profit-loss,
// semua nerima query `from`/`to` (YYYY-MM-DD, WIB-aware di backend lewat
// parseDateRange). Angka yang balik dari backend semua udah di-Number()-in
// server-side (bukan Decimal string), jadi aman langsung dipakai.

interface SalesReport {
  totalPenjualan: number;
  totalInvoice: number;
  totalDiskon: number;
  totalPajak: number;
  breakdownKategori: { category: string; totalLine: number; qty: number }[];
  grafikHarian: { date: string; total: number; count: number }[];
}

interface ServiceReport {
  jumlahPerStatus: { status: string; count: number }[];
  rataRataWaktuPengerjaanMenit: number | null;
  performaTeknisi: { technicianId: string; namaTeknisi: string; jobSelesai: number }[];
}

interface ProfitLossReport {
  ringkasan: {
    totalPendapatan: number;
    totalHpp: number;
    labaKotor: number;
    marginPersen: number;
    // Paket AC Split: penjualan satuan HPP-nya 0, jadi labaKotor optimis.
    // Batas bawah = tiap unit satuan nanggung modal paket penuh.
    barisJualSatuanTanpaModal?: number;
    modalPaketTakTeralokasiMaks?: number;
    labaKotorTerendah?: number;
  };
  detailPerItem: {
    kind: string;
    refId: string | null;
    name: string;
    qtyTerjual: number;
    revenue: number;
    buyPriceDipakai: number;
    hpp: number;
    catatan: string;
  }[];
}

// Point 4 (2026-09-23) — Laporan Stok/Opname. `unitGabungan` cuma keisi di
// baris produk Indoor (Point 2, `pairedProductId` keisi) — ringkasan
// gabungan Indoor+Outdoor dari aksi "Unit Lengkap", ditampilin menjorok di
// bawah baris Indoor-nya (lihat ReportsService.productStockReport).
interface StockReportRow {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  category: string | null;
  stokAwal: number;
  stokMasuk: number;
  stokKeluar: number;
  sisaStok: number;
  modalTersisa: number;
  omzetTerjual: number;
  untungTerjual: number;
  unitGabungan?: {
    namaPasangan: string;
    stokMasuk: number;
    stokKeluar: number;
    sisaStok: number;
  };
  // BARU (Paket AC Split, 2026-09-30) — peran unit AC. Backend nempatin
  // baris Outdoor sebuah paket PERSIS di bawah baris Indoor-nya.
  pairRole?: 'indoor' | 'outdoor';
  // Qty yang dijual satuan dari paket (modal tidak dialokasikan).
  jualSatuanTanpaModal?: number;
}

interface StockReport {
  items: StockReportRow[];
  ringkasan: { totalModalTersisa: number; totalOmzetTerjual: number; totalUntungTerjual: number };
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function firstOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default function LaporanPage() {
  const [from, setFrom] = React.useState(() => toDateInput(firstOfMonth()));
  const [to, setTo] = React.useState(() => toDateInput(new Date()));
  const [tab, setTab] = React.useState('penjualan');

  const rangeValid = Boolean(from && to && from <= to);

  function applyPreset(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setFrom(toDateInput(start));
    setTo(toDateInput(end));
  }

  function applyThisMonth() {
    setFrom(toDateInput(firstOfMonth()));
    setTo(toDateInput(new Date()));
  }

  const salesQuery = useQuery({
    queryKey: ['reports', 'sales', from, to],
    queryFn: () => apiClient.get<SalesReport>(`/reports/sales?from=${from}&to=${to}`),
    enabled: tab === 'penjualan' && rangeValid,
  });

  const serviceQuery = useQuery({
    queryKey: ['reports', 'service', from, to],
    queryFn: () => apiClient.get<ServiceReport>(`/reports/service?from=${from}&to=${to}`),
    enabled: tab === 'servis' && rangeValid,
  });

  const profitLossQuery = useQuery({
    queryKey: ['reports', 'profit-loss', from, to],
    queryFn: () => apiClient.get<ProfitLossReport>(`/reports/profit-loss?from=${from}&to=${to}`),
    enabled: tab === 'laba-rugi' && rangeValid,
  });

  const [stokKind, setStokKind] = React.useState<'all' | 'product' | 'sparepart'>('all');

  const stockQuery = useQuery({
    queryKey: ['reports', 'stock-movements', from, to, stokKind],
    queryFn: () =>
      apiClient.get<StockReport>(
        `/reports/stock-movements?from=${from}&to=${to}${stokKind !== 'all' ? `&kind=${stokKind}` : ''}`,
      ),
    enabled: tab === 'stok' && rangeValid,
  });

  const maxHarian = Math.max(1, ...(salesQuery.data?.grafikHarian.map((d) => d.total) ?? [0]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Laporan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rekap penjualan, servis, dan laba-rugi berdasarkan rentang tanggal.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="grid gap-1.5">
            <Label htmlFor="from">Dari</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="to">Sampai</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(7)}>
              7 Hari
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(30)}>
              30 Hari
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={applyThisMonth}>
              Bulan Ini
            </Button>
          </div>
          {!rangeValid && (
            <p className="text-sm text-destructive">
              Tanggal &quot;Dari&quot; tidak boleh setelah &quot;Sampai&quot;.
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-4 sm:w-fit">
          <TabsTrigger value="penjualan">Penjualan</TabsTrigger>
          <TabsTrigger value="servis">Servis</TabsTrigger>
          <TabsTrigger value="laba-rugi">Laba-Rugi</TabsTrigger>
          <TabsTrigger value="stok">Stok</TabsTrigger>
        </TabsList>

        <TabsContent value="penjualan" className="mt-4 grid gap-4">
          {salesQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {salesQuery.isError && <p className="text-sm text-destructive">Gagal memuat laporan penjualan.</p>}
          {salesQuery.data && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryCard label="Total Penjualan" value={formatRupiah(salesQuery.data.totalPenjualan)} />
                <SummaryCard label="Jumlah Invoice" value={String(salesQuery.data.totalInvoice)} />
                <SummaryCard label="Total Diskon" value={formatRupiah(salesQuery.data.totalDiskon)} />
                <SummaryCard label="Total Pajak" value={formatRupiah(salesQuery.data.totalPajak)} />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Grafik Harian</CardTitle>
                  <CardDescription>Total penjualan per hari dalam rentang yang dipilih.</CardDescription>
                </CardHeader>
                <CardContent>
                  {salesQuery.data.grafikHarian.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Tidak ada transaksi di rentang ini.</p>
                  ) : (
                    <div className="flex h-40 items-end gap-1.5 overflow-x-auto pb-1">
                      {salesQuery.data.grafikHarian.map((d) => (
                        <div
                          key={d.date}
                          className="flex min-w-8 flex-1 flex-col items-center gap-1"
                          title={`${formatDate(d.date)}: ${formatRupiah(d.total)} (${d.count} invoice)`}
                        >
                          <div
                            className="w-full rounded-t bg-primary/70"
                            style={{ height: `${Math.max(4, (d.total / maxHarian) * 100)}%` }}
                          />
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatDate(d.date)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Breakdown per Kategori</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kategori</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salesQuery.data.breakdownKategori.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                            Tidak ada data.
                          </TableCell>
                        </TableRow>
                      )}
                      {salesQuery.data.breakdownKategori.map((row) => (
                        <TableRow key={row.category}>
                          <TableCell>{row.category}</TableCell>
                          <TableCell className="text-right">{row.qty}</TableCell>
                          <TableCell className="text-right">{formatRupiah(row.totalLine)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="servis" className="mt-4 grid gap-4">
          {serviceQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {serviceQuery.isError && <p className="text-sm text-destructive">Gagal memuat laporan servis.</p>}
          {serviceQuery.data && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {serviceQuery.data.jumlahPerStatus.map((s) => (
                  <SummaryCard key={s.status} label={statusLabel(s.status)} value={String(s.count)} />
                ))}
                <SummaryCard
                  label="Rata-rata Waktu Pengerjaan"
                  value={
                    serviceQuery.data.rataRataWaktuPengerjaanMenit != null
                      ? `${serviceQuery.data.rataRataWaktuPengerjaanMenit} menit`
                      : '-'
                  }
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Performa Teknisi</CardTitle>
                  <CardDescription>Jumlah job berstatus &quot;selesai&quot; per teknisi.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Teknisi</TableHead>
                        <TableHead className="text-right">Job Selesai</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {serviceQuery.data.performaTeknisi.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                            Tidak ada data.
                          </TableCell>
                        </TableRow>
                      )}
                      {serviceQuery.data.performaTeknisi.map((t) => (
                        <TableRow key={t.technicianId}>
                          <TableCell>{t.namaTeknisi}</TableCell>
                          <TableCell className="text-right">{t.jobSelesai}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="laba-rugi" className="mt-4 grid gap-4">
          {profitLossQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {profitLossQuery.isError && (
            <p className="text-sm text-destructive">Gagal memuat laporan laba-rugi.</p>
          )}
          {profitLossQuery.data && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryCard
                  label="Total Pendapatan"
                  value={formatRupiah(profitLossQuery.data.ringkasan.totalPendapatan)}
                />
                <SummaryCard label="Total HPP" value={formatRupiah(profitLossQuery.data.ringkasan.totalHpp)} />
                <SummaryCard
                  label="Laba Kotor"
                  value={formatRupiah(profitLossQuery.data.ringkasan.labaKotor)}
                />
                <SummaryCard label="Margin" value={`${profitLossQuery.data.ringkasan.marginPersen}%`} />
              </div>

              {(profitLossQuery.data.ringkasan.barisJualSatuanTanpaModal ?? 0) > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                  <p className="font-medium">
                    Ada {profitLossQuery.data.ringkasan.barisJualSatuanTanpaModal} baris penjualan satuan
                    (Indoor/Outdoor saja) — modalnya belum dialokasikan, jadi Laba Kotor di atas
                    masih optimis.
                  </p>
                  {(profitLossQuery.data.ringkasan.modalPaketTakTeralokasiMaks ?? 0) > 0 ? (
                    <p className="mt-1">
                      Laba kotor sebenarnya ada di antara{' '}
                      <span className="font-semibold">
                        {formatRupiah(profitLossQuery.data.ringkasan.labaKotorTerendah ?? 0)}
                      </span>{' '}
                      (kalau tiap unit satuan nanggung modal 1 paket penuh, maks{' '}
                      {formatRupiah(profitLossQuery.data.ringkasan.modalPaketTakTeralokasiMaks ?? 0)}) sampai{' '}
                      <span className="font-semibold">
                        {formatRupiah(profitLossQuery.data.ringkasan.labaKotor)}
                      </span>{' '}
                      (kalau modalnya dianggap 0). Kalau Indoor dan Outdoor dari paket yang sama
                      dua-duanya dijual satuan, batas bawah ini kehitung dobel.
                    </p>
                  ) : (
                    <p className="mt-1">
                      Modal paket belum tercatat untuk baris-baris ini (transaksi sebelum estimasi
                      modal paket ada), jadi batas bawah laba belum bisa dihitung.
                    </p>
                  )}
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Detail per Item</CardTitle>
                  <CardDescription>
                    HPP dihitung dari harga beli saat transaksi (snapshot) kalau tersedia — catatan di
                    kolom terakhir menjelaskan sumber HPP tiap baris.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama</TableHead>
                        <TableHead>Jenis</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">HPP</TableHead>
                        <TableHead>Catatan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profitLossQuery.data.detailPerItem.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                            Tidak ada data.
                          </TableCell>
                        </TableRow>
                      )}
                      {profitLossQuery.data.detailPerItem.map((row, idx) => (
                        <TableRow key={`${row.kind}-${row.refId ?? idx}`}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {row.kind}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{row.qtyTerjual}</TableCell>
                          <TableCell className="text-right">{formatRupiah(row.revenue)}</TableCell>
                          <TableCell className="text-right">{formatRupiah(row.hpp)}</TableCell>
                          <TableCell className="max-w-64 text-xs text-muted-foreground">
                            {row.catatan}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="stok" className="mt-4 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="stok-kind" className="text-sm text-muted-foreground">
                Jenis
              </Label>
              <Select value={stokKind} onValueChange={(v) => setStokKind(v as typeof stokKind)}>
                <SelectTrigger id="stok-kind" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="product">Produk</SelectItem>
                  <SelectItem value="sparepart">Sparepart</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {rangeValid && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/laporan/stok/print?from=${from}&to=${to}${stokKind !== 'all' ? `&kind=${stokKind}` : ''}`} target="_blank">
                  <Printer className="size-4" />
                  Cetak PDF
                </Link>
              </Button>
            )}
          </div>

          {stockQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {stockQuery.isError && <p className="text-sm text-destructive">Gagal memuat laporan stok.</p>}
          {stockQuery.data && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <SummaryCard label="Modal Tersisa (stok saat ini)" value={formatRupiah(stockQuery.data.ringkasan.totalModalTersisa)} />
                <SummaryCard label="Omzet Terjual (rentang ini)" value={formatRupiah(stockQuery.data.ringkasan.totalOmzetTerjual)} />
                <SummaryCard label="Untung Terjual (rentang ini)" value={formatRupiah(stockQuery.data.ringkasan.totalUntungTerjual)} />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Rincian per Item</CardTitle>
                  <CardDescription>
                    Produk AC paket: baris Outdoor ditampilin menjorok tepat di bawah Indoor-nya (sekali aja), dengan info jumlah paket lengkap yang siap dijual.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama</TableHead>
                        <TableHead className="text-right">Stok Awal</TableHead>
                        <TableHead className="text-right">Masuk</TableHead>
                        <TableHead className="text-right">Keluar</TableHead>
                        <TableHead className="text-right">Sisa</TableHead>
                        <TableHead className="text-right">Modal Tersisa</TableHead>
                        <TableHead className="text-right">Omzet</TableHead>
                        <TableHead className="text-right">Untung</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockQuery.data.items.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                            Tidak ada item.
                          </TableCell>
                        </TableRow>
                      )}
                      {stockQuery.data.items.map((row, i, rows) => {
                        // Paket AC Split (2026-09-30) — Outdoor sebuah paket
                        // udah ditaruh backend persis di bawah Indoor-nya;
                        // tampil SEKALI, menjorok (gak ada lagi baris
                        // ringkasan "↳ Unit ..." terpisah yang dobel).
                        const isPackageOutdoor = row.pairRole === 'outdoor' && rows[i - 1]?.unitGabungan?.namaPasangan === row.name;
                        return (
                          <TableRow key={`${row.itemKind}-${row.refId}`} className={isPackageOutdoor ? 'bg-muted/30' : undefined}>
                            <TableCell className={isPackageOutdoor ? 'pl-8' : undefined}>
                              {isPackageOutdoor && <span className="mr-1 text-muted-foreground">↳</span>}
                              {row.name}
                              <Badge variant="outline" className="ml-2 capitalize">
                                {row.pairRole ?? row.itemKind}
                              </Badge>
                              {row.unitGabungan && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  Paket lengkap siap: {row.unitGabungan.sisaStok} (pasangan: {row.unitGabungan.namaPasangan})
                                </p>
                              )}
                              {row.jualSatuanTanpaModal ? (
                                <p className="mt-0.5 text-xs text-amber-700">
                                  {row.jualSatuanTanpaModal} unit dijual satuan — modal tidak dialokasikan
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right">{row.stokAwal}</TableCell>
                            <TableCell className="text-right">{row.stokMasuk}</TableCell>
                            <TableCell className="text-right">{row.stokKeluar}</TableCell>
                            <TableCell className="text-right">{row.sisaStok}</TableCell>
                            <TableCell className="text-right">{formatRupiah(row.modalTersisa)}</TableCell>
                            <TableCell className="text-right">{formatRupiah(row.omzetTerjual)}</TableCell>
                            <TableCell className="text-right">{formatRupiah(row.untungTerjual)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
