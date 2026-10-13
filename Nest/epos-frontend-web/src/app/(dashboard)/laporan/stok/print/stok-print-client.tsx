'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatRupiah, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { SPAREPART_GROUP, groupLabel, groupStockRows, hideEmptyRows } from '@/lib/stock-group';

interface StockReportRow {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  brand?: string | null;
  unit: string;
  stokAwal: number;
  stokMasuk: number;
  stokKeluar: number;
  sisaStok: number;
  // Opsional: backend membuangnya untuk role gudang.
  modalTersisa?: number;
  omzetTerjual?: number;
  untungTerjual?: number;
  unitGabungan?: { namaPasangan: string; stokMasuk: number; stokKeluar: number; sisaStok: number };
  // Paket AC Split (2026-09-30) — lihat laporan/page.tsx.
  pairRole?: 'indoor' | 'outdoor';
  jualSatuanTanpaModal?: number;
}

interface StockReport {
  items: StockReportRow[];
  ringkasan?: { totalModalTersisa: number; totalOmzetTerjual: number; totalUntungTerjual: number };
}

export function StokPrintClient({
  from,
  to,
  kind,
  brand,
  showEmpty,
}: {
  from: string;
  to: string;
  kind?: string;
  brand?: string;
  showEmpty?: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'stock-movements', 'print', from, to, kind],
    queryFn: () =>
      apiClient.get<StockReport>(
        `/reports/stock-movements?from=${from}&to=${to}${kind ? `&kind=${kind}` : ''}`,
      ),
    enabled: Boolean(from && to),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat laporan...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat laporan stok.</p>;

  const showMoney = Boolean(data.ringkasan);
  const scoped = data.items.filter((r) => !brand || groupLabel(r) === brand);
  const { shown, hiddenCount } = showEmpty ? { shown: scoped, hiddenCount: 0 } : hideEmptyRows(scoped);
  const groups = groupStockRows(shown);
  // Kolom angka sempit & seragam supaya Nama dapat sisa lebar terbesar.
  const num = 'border border-black p-1 text-right';
  const jenisLabel = (r: StockReportRow) =>
    r.pairRole === 'indoor' ? 'Indoor' : r.pairRole === 'outdoor' ? 'Outdoor' : r.itemKind === 'sparepart' ? 'Sparepart' : 'Produk';

  return (
    <div className={showMoney ? 'mx-auto max-w-[297mm]' : 'mx-auto max-w-[210mm]'}>
      {/* Versi admin punya kolom Rupiah (Modal/Omzet/Untung) -> A4 landscape biar
          semua kolom muat. Versi gudang (tanpa Rupiah, 8 kolom) -> A4 portrait,
          seperti kartu stok kertas. */}
      <style>{`@page { size: A4 ${showMoney ? 'landscape' : 'portrait'}; margin: 10mm; }`}</style>

      <div className="mb-4 flex items-center justify-end print:hidden">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak
        </Button>
      </div>

      {groups.length === 0 && <p className="p-6 text-sm text-muted-foreground">Tidak ada item.</p>}

      {/* SATU MERK = SATU LEMBAR (page break antar merk) supaya gampang
          di-crosscheck per rak/merk. Lembar terakhir tanpa break. */}
      {groups.map((g, gi) => {
        const isLast = gi === groups.length - 1;
        return (
          <div
            key={g.label}
            className="bg-white p-2 text-black"
            style={isLast ? undefined : { breakAfter: 'page', pageBreakAfter: 'always' }}
          >
            <div className="text-center">
              <p className="text-lg font-bold">AYUB AC</p>
              <p className="text-sm font-semibold">Laporan Stok - {g.label}</p>
              <p className="text-xs">
                {formatDate(from)} - {formatDate(to)}
              </p>
              {gi === 0 && hiddenCount > 0 && (
                <p className="text-[9px] italic">{hiddenCount} barang tanpa stok tidak dicetak.</p>
              )}
            </div>

            <table className={`mt-3 w-full border-collapse border border-black ${showMoney ? 'text-[9px]' : 'text-[10px]'}`}>
              <thead>
                <tr>
                  <th className="border border-black p-1 text-left">Nama</th>
                  <th className="w-16 border border-black p-1">Jenis</th>
                  <th className="w-14 border border-black p-1">Stok Awal</th>
                  <th className="w-14 border border-black p-1">Masuk</th>
                  <th className="w-14 border border-black p-1">Keluar</th>
                  <th className="w-16 border border-black p-1">Stok Sekarang</th>
                  {!showMoney && (
                    <>
                      <th className="w-16 border border-black p-1">Fisik</th>
                      <th className="w-16 border border-black p-1">Selisih</th>
                    </>
                  )}
                  {showMoney && (
                    <>
                      <th className="border border-black p-1">Modal Tersisa</th>
                      <th className="border border-black p-1">Omzet</th>
                      <th className="border border-black p-1">Untung</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row, i, rows) => {
                  // Paket AC Split (2026-09-30) — Outdoor sebuah paket tampil
                  // sekali, menjorok tepat di bawah Indoor-nya.
                  const isPackageOutdoor = row.pairRole === 'outdoor' && rows[i - 1]?.unitGabungan?.namaPasangan === row.name;
                  return (
                    <tr key={`${row.itemKind}-${row.refId}`}>
                      <td className={`border border-black p-1${isPackageOutdoor ? ' pl-4' : ''}`}>
                        {isPackageOutdoor ? '↳ ' : ''}
                        {row.name}
                        {row.unitGabungan && (
                          <div className="text-[8px] italic">
                            Set lengkap siap jual: {row.unitGabungan.sisaStok}
                          </div>
                        )}
                        {row.jualSatuanTanpaModal ? (
                          <div className="text-[8px] italic">
                            {row.jualSatuanTanpaModal} unit dijual satuan - modal tidak dialokasikan
                          </div>
                        ) : null}
                      </td>
                      <td className="border border-black p-1 text-center">{jenisLabel(row)}</td>
                      <td className={num}>{row.stokAwal}</td>
                      <td className={num}>{row.stokMasuk}</td>
                      <td className={num}>{row.stokKeluar}</td>
                      <td className={`${num} font-semibold`}>{row.sisaStok}</td>
                      {!showMoney && (
                        <>
                          <td className="border border-black p-1" />
                          <td className="border border-black p-1" />
                        </>
                      )}
                      {showMoney && (
                        <>
                          <td className="border border-black p-1 text-right">{formatRupiah(row.modalTersisa ?? 0)}</td>
                          <td className="border border-black p-1 text-right">{formatRupiah(row.omzetTerjual ?? 0)}</td>
                          <td className="border border-black p-1 text-right">{formatRupiah(row.untungTerjual ?? 0)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
                {/* Subtotal sisa per merk (sparepart gak dijumlah: satuan campur). */}
                <tr className="bg-gray-200 font-bold">
                  <td className="border border-black p-1" colSpan={5}>
                    Total {g.label} ({g.rows.length} item)
                  </td>
                  <td className="border border-black p-1 text-right">{g.label === SPAREPART_GROUP ? '' : g.totalSisa}</td>
                  <td className="border border-black p-1" colSpan={showMoney ? 3 : 2} />
                </tr>
              </tbody>
            </table>

            {!showMoney && (
              <div className="mt-8 flex justify-between text-[10px]">
                <p>Dicek oleh: ______________________</p>
                <p>Tanggal cek: ____ / ____ / ________</p>
                <p>Mengetahui: ______________________</p>
              </div>
            )}

            {/* Ringkasan keuangan (admin) cuma di lembar terakhir. */}
            {isLast && data.ringkasan && (
              <table className="mt-2 w-64 border-collapse border border-black text-[9px]">
                <tbody>
                  <tr>
                    <td className="border border-black p-1 font-bold">Total Modal Tersisa</td>
                    <td className="border border-black p-1 text-right">{formatRupiah(data.ringkasan.totalModalTersisa)}</td>
                  </tr>
                  <tr>
                    <td className="border border-black p-1 font-bold">Total Omzet Terjual</td>
                    <td className="border border-black p-1 text-right">{formatRupiah(data.ringkasan.totalOmzetTerjual)}</td>
                  </tr>
                  <tr>
                    <td className="border border-black p-1 font-bold">Total Untung Terjual</td>
                    <td className="border border-black p-1 text-right">{formatRupiah(data.ringkasan.totalUntungTerjual)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
