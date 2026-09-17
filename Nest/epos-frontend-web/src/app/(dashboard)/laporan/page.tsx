'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { formatRupiah, formatDate, statusLabel } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

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
        <TabsList className="grid w-full grid-cols-3 sm:w-fit">
          <TabsTrigger value="penjualan">Penjualan</TabsTrigger>
          <TabsTrigger value="servis">Servis</TabsTrigger>
          <TabsTrigger value="laba-rugi">Laba-Rugi</TabsTrigger>
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
