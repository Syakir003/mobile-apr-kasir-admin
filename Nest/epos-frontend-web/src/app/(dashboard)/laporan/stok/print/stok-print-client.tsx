'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatRupiah, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';

interface StockReportRow {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  stokAwal: number;
  stokMasuk: number;
  stokKeluar: number;
  sisaStok: number;
  modalTersisa: number;
  omzetTerjual: number;
  untungTerjual: number;
  unitGabungan?: { namaPasangan: string; stokMasuk: number; stokKeluar: number; sisaStok: number };
  // Paket AC Split (2026-09-30) — lihat laporan/page.tsx.
  pairRole?: 'indoor' | 'outdoor';
  jualSatuanTanpaModal?: number;
}

interface StockReport {
  items: StockReportRow[];
  ringkasan: { totalModalTersisa: number; totalOmzetTerjual: number; totalUntungTerjual: number };
}

export function StokPrintClient({ from, to, kind }: { from: string; to: string; kind?: string }) {
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

  return (
    <div className="mx-auto max-w-[297mm]">
      {/* Laporan tabular (banyak kolom) — pola @page A4 landscape, beda dari
          invoice yang portrait, biar semua kolom muat gak kepotong. */}
      <style>{'@page { size: A4 landscape; margin: 10mm; }'}</style>

      <div className="mb-4 flex items-center justify-end print:hidden">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak
        </Button>
      </div>

      <div className="bg-white p-2 text-black">
        <div className="text-center">
          <p className="text-lg font-bold">AYUB AC</p>
          <p className="text-sm font-semibold">Laporan Stok</p>
          <p className="text-xs">
            {formatDate(from)} — {formatDate(to)}
          </p>
        </div>

        <table className="mt-3 w-full border-collapse border border-black text-[9px]">
          <thead>
            <tr>
              <th className="border border-black p-1">Nama</th>
              <th className="border border-black p-1">Jenis</th>
              <th className="border border-black p-1">Stok Awal</th>
              <th className="border border-black p-1">Masuk</th>
              <th className="border border-black p-1">Keluar</th>
              <th className="border border-black p-1">Sisa</th>
              <th className="border border-black p-1">Modal Tersisa</th>
              <th className="border border-black p-1">Omzet</th>
              <th className="border border-black p-1">Untung</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row, i, rows) => {
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
                        Paket lengkap siap: {row.unitGabungan.sisaStok} (pasangan: {row.unitGabungan.namaPasangan})
                      </div>
                    )}
                    {row.jualSatuanTanpaModal ? (
                      <div className="text-[8px] italic">
                        {row.jualSatuanTanpaModal} unit dijual satuan — modal tidak dialokasikan
                      </div>
                    ) : null}
                  </td>
                  <td className="border border-black p-1 text-center capitalize">{row.pairRole ?? row.itemKind}</td>
                  <td className="border border-black p-1 text-right">{row.stokAwal}</td>
                  <td className="border border-black p-1 text-right">{row.stokMasuk}</td>
                  <td className="border border-black p-1 text-right">{row.stokKeluar}</td>
                  <td className="border border-black p-1 text-right">{row.sisaStok}</td>
                  <td className="border border-black p-1 text-right">{formatRupiah(row.modalTersisa)}</td>
                  <td className="border border-black p-1 text-right">{formatRupiah(row.omzetTerjual)}</td>
                  <td className="border border-black p-1 text-right">{formatRupiah(row.untungTerjual)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

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
      </div>
    </div>
  );
}
