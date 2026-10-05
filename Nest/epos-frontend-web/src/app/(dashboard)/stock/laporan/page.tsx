'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { SPAREPART_GROUP, groupLabel, groupStockRows } from '@/lib/stock-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Laporan stok untuk gudang (pencocokan fisik): sama dengan tab Stok di
// /laporan (admin) TAPI tanpa modal/omzet/untung — backend sudah membuang
// field itu untuk role gudang (ReportsController.stockMovements).
interface Row {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  brand?: string | null;
  stokAwal: number;
  stokMasuk: number;
  stokKeluar: number;
  sisaStok: number;
  unitGabungan?: { namaPasangan: string; sisaStok: number };
  pairRole?: 'indoor' | 'outdoor';
}

const toDateInput = (d: Date) => d.toISOString().slice(0, 10);

export default function LaporanStokGudangPage() {
  const [from, setFrom] = React.useState(() => {
    const d = new Date();
    return toDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [to, setTo] = React.useState(() => toDateInput(new Date()));
  const [kind, setKind] = React.useState<'all' | 'product' | 'sparepart'>('all');
  const rangeValid = Boolean(from && to && from <= to);
  const [brand, setBrand] = React.useState('all');
  const [showEmpty, setShowEmpty] = React.useState(false);
  const kindQs = kind !== 'all' ? `&kind=${kind}` : '';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'stock-movements', 'gudang', from, to, kind],
    queryFn: () => apiClient.get<{ items: Row[] }>(`/reports/stock-movements?from=${from}&to=${to}${kindQs}`),
    enabled: rangeValid,
  });

  const brands = React.useMemo(
    () => groupStockRows(data?.items ?? []).map((g) => g.label),
    [data],
  );
  // Barang tanpa stok & tanpa pergerakan (semua angka 0) disembunyikan secara
  // default — katalog besar membuat laporan penuh baris nol. Paket Indoor+Outdoor
  // disembunyikan hanya bila KEDUANYA nol, supaya pasangan tidak terpisah.
  const { shown, hiddenCount } = React.useMemo(() => {
    const items = (data?.items ?? []).filter((r) => brand === 'all' || groupLabel(r) === brand);
    if (showEmpty) return { shown: items, hiddenCount: 0 };
    const isEmpty = (r: Row) => !r.stokAwal && !r.stokMasuk && !r.stokKeluar && !r.sisaStok;
    const kept: Row[] = [];
    let hidden = 0;
    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      const next = items[i + 1];
      const pairNext =
        r.unitGabungan && next?.pairRole === 'outdoor' && next.name === r.unitGabungan.namaPasangan ? next : undefined;
      const unit = pairNext ? [r, pairNext] : [r];
      if (unit.every(isEmpty)) hidden += unit.length;
      else kept.push(...unit);
      if (pairNext) i++;
    }
    return { shown: kept, hiddenCount: hidden };
  }, [data, brand, showEmpty]);
  const groups = React.useMemo(() => groupStockRows(shown), [shown]);
  const fmtDate = (d: string) => d.split('-').reverse().join('/');

  function preset(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setFrom(toDateInput(start));
    setTo(toDateInput(end));
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Laporan Stok</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Stok awal, masuk, keluar, dan sisa per item — dasar untuk mencocokkan stok sistem dengan fisik.
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
          <div className="grid gap-1.5">
            <Label htmlFor="kind">Jenis</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger id="kind" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="product">Produk</SelectItem>
                <SelectItem value="sparepart">Sparepart</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="brand">Merk</Label>
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger id="brand" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua merk</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox id="show-empty" checked={showEmpty} onCheckedChange={(v) => setShowEmpty(v === true)} />
            <Label htmlFor="show-empty" className="font-normal">
              Tampilkan juga barang tanpa stok
            </Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => preset(7)}>
              7 Hari
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => preset(30)}>
              30 Hari
            </Button>
          </div>
          {rangeValid && (
            <Button variant="outline" size="sm" asChild className="ml-auto">
              <Link href={`/laporan/stok/print?from=${from}&to=${to}${kindQs}${brand !== 'all' ? `&brand=${encodeURIComponent(brand)}` : ''}`} target="_blank">
                <Printer className="size-4" />
                Cetak PDF
              </Link>
            </Button>
          )}
          {!rangeValid && <p className="text-sm text-destructive">Tanggal &quot;Dari&quot; tidak boleh setelah &quot;Sampai&quot;.</p>}
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat laporan stok.</p>}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rincian per Merk</CardTitle>
            <CardDescription>
              Indoor dan Outdoor yang berpasangan ditandai garis di kiri dan dihitung sebagai satu set.
              {hiddenCount > 0 && ` ${hiddenCount} barang tanpa stok disembunyikan.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead className="text-right">
                    Stok Awal
                    <span className="block text-xs font-normal text-muted-foreground">sebelum {fmtDate(from)}</span>
                  </TableHead>
                  <TableHead className="text-right">
                    Masuk
                    <span className="block text-xs font-normal text-muted-foreground">selama periode</span>
                  </TableHead>
                  <TableHead className="text-right">
                    Keluar
                    <span className="block text-xs font-normal text-muted-foreground">selama periode</span>
                  </TableHead>
                  <TableHead className="text-right">
                    Stok Sekarang
                    <span className="block text-xs font-normal text-muted-foreground">menurut sistem</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      {hiddenCount === 0
                        ? 'Tidak ada item.'
                        : 'Belum ada barang yang punya stok. Centang "Tampilkan juga barang tanpa stok" untuk melihat semuanya.'}
                    </TableCell>
                  </TableRow>
                )}
                {groups.map((g) => (
                  <React.Fragment key={g.label}>
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableCell colSpan={4} className="font-semibold">
                        {g.label}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{g.rows.length} item</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{g.label === SPAREPART_GROUP ? '' : g.totalSisa}</TableCell>
                    </TableRow>
                    {g.rows.map((row, i, rows) => {
                      const isPackageOutdoor = row.pairRole === 'outdoor' && rows[i - 1]?.unitGabungan?.namaPasangan === row.name;
                      return (
                        <TableRow key={`${row.itemKind}-${row.refId}`} className={isPackageOutdoor ? 'bg-muted/30' : undefined}>
                          <TableCell
                            className={cn(
                              isPackageOutdoor && 'pl-8',
                              (isPackageOutdoor || row.unitGabungan) && 'border-l-4 border-l-primary/40',
                            )}
                          >
                            {isPackageOutdoor && <span className="mr-1 text-muted-foreground">↳</span>}
                            {row.name}
                            {row.pairRole && (
                              <Badge variant="outline" className="ml-2 capitalize">
                                {row.pairRole}
                              </Badge>
                            )}
                            {row.unitGabungan && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Set lengkap siap jual: {row.unitGabungan.sisaStok}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{row.stokAwal}</TableCell>
                          <TableCell className="text-right">{row.stokMasuk}</TableCell>
                          <TableCell className="text-right">{row.stokKeluar}</TableCell>
                          <TableCell className="text-right font-medium">{row.sisaStok}</TableCell>
                        </TableRow>
                      );
                    })}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
