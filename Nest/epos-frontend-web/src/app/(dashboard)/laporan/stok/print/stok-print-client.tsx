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
  masukDari?: string;
  keluarDetail?: { tanggal: string; pihak: string; qty: number }[];
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
  const cell = 'border border-black px-1.5 py-1 align-top';
  const num = `${cell} text-right tabular-nums`;
  const head = 'border border-black bg-gray-200 px-1 py-1.5 text-center align-middle text-[11px] font-bold leading-tight';
  const jenisLabel = (r: StockReportRow) =>
    r.pairRole === 'indoor' ? 'Indoor' : r.pairRole === 'outdoor' ? 'Outdoor' : r.itemKind === 'sparepart' ? 'Sparepart' : 'Produk';
  // Lebar kolom tetap (px @96dpi, A4 landscape ~1047px) — Nama dapat sisa lebar.
  const widths = showMoney
    ? [30, undefined, 66, 52, 56, 110, 56, 66, 110, 72, 84, 84, 84]
    : [30, undefined, 66, 52, 56, 130, 56, 66, 140, 72, 62, 62];
  const printedAt = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
  // Kolom sebelum "Stok Sekarang": No, Nama, Jenis, Awal, Masuk, Masuk dari, Keluar, Tgl, Keluar ke.
  const colsBeforeSisa = 9;

  return (
    <div className="mx-auto max-w-[297mm]">
      {/* A4 landscape untuk semua peran: lebar cukup buat huruf besar (gudang) maupun kolom Rupiah (admin).
          Header kolom diulang di tiap halaman & baris tidak terpotong di tengah. */}
      <style>{`@page { size: A4 landscape; margin: 10mm; }
        .stok-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .stok-print thead { display: table-header-group; }
        .stok-print tr { break-inside: avoid; }`}</style>

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
        let no = 0;
        return (
          <div
            key={g.label}
            className="stok-print bg-white p-2 text-black"
            style={isLast ? undefined : { breakAfter: 'page', pageBreakAfter: 'always' }}
          >
            <div className="border-b-2 border-black pb-2 text-center">
              <p className="text-xl font-bold tracking-wide">AYUB AC</p>
              <p className="text-base font-semibold">Laporan Stok - {g.label}</p>
            </div>
            <div className="mt-1.5 flex justify-between text-[11px]">
              <p>
                Periode:{' '}
                <b>
                  {formatDate(from)} - {formatDate(to)}
                </b>
                {gi === 0 && hiddenCount > 0 && <i className="ml-3">({hiddenCount} barang tanpa stok tidak dicetak)</i>}
              </p>
              <p>Dicetak: {printedAt}</p>
            </div>

            <table className={`mt-2 w-full table-fixed border-collapse border border-black ${showMoney ? 'text-[11px]' : 'text-[13px]'}`}>
              <colgroup>
                {widths.map((w, ci) => (
                  <col key={ci} style={w ? { width: `${w}px` } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className={head}>No</th>
                  <th className={`${head} text-left`}>Nama</th>
                  <th className={head}>Jenis</th>
                  <th className={head}>Stok Awal</th>
                  <th className={head}>Masuk</th>
                  <th className={head}>Masuk dari</th>
                  <th className={head}>Keluar</th>
                  <th className={head}>Tgl Keluar</th>
                  <th className={head}>Keluar ke</th>
                  <th className={head}>Stok Sekarang</th>
                  {!showMoney && (
                    <>
                      <th className={head}>Fisik</th>
                      <th className={head}>Selisih</th>
                    </>
                  )}
                  {showMoney && (
                    <>
                      <th className={head}>Modal Tersisa</th>
                      <th className={head}>Omzet</th>
                      <th className={head}>Untung</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row, i, rows) => {
                  // Paket AC Split (2026-09-30) — Outdoor sebuah paket tampil
                  // sekali, menjorok tepat di bawah Indoor-nya (tanpa nomor sendiri).
                  const isPackageOutdoor = row.pairRole === 'outdoor' && rows[i - 1]?.unitGabungan?.namaPasangan === row.name;
                  if (!isPackageOutdoor) no += 1;
                  const keluar = row.keluarDetail ?? [];
                  return (
                    <tr key={`${row.itemKind}-${row.refId}`}>
                      <td className={`${cell} text-center`}>{isPackageOutdoor ? '' : no}</td>
                      <td className={`${cell}${isPackageOutdoor ? ' pl-5' : ''}`}>
                        {isPackageOutdoor ? '↳ ' : ''}
                        {row.name}
                        {row.unitGabungan && (
                          <div className="text-[10px] italic">
                            Set lengkap siap jual: {row.unitGabungan.sisaStok}
                          </div>
                        )}
                        {row.jualSatuanTanpaModal ? (
                          <div className="text-[10px] italic">
                            {row.jualSatuanTanpaModal} unit dijual satuan - modal tidak dialokasikan
                          </div>
                        ) : null}
                      </td>
                      <td className={`${cell} text-center`}>{jenisLabel(row)}</td>
                      <td className={num}>{row.stokAwal}</td>
                      <td className={num}>{row.stokMasuk}</td>
                      <td className={`${cell} text-[11px] leading-tight`}>{row.masukDari || '-'}</td>
                      <td className={num}>{row.stokKeluar}</td>
                      {/* Tgl & Keluar ke dirender per baris setinggi sama (satu baris, tanpa wrap)
                          supaya tanggal sejajar dengan pihaknya. */}
                      <td className={`${cell} text-center text-[11px] leading-tight`}>
                        {keluar.length
                          ? keluar.map((k, ki) => (
                              <div key={ki} className="h-[16px] whitespace-nowrap leading-[16px]">
                                {k.tanggal}
                              </div>
                            ))
                          : '-'}
                      </td>
                      <td className={`${cell} text-[11px] leading-tight`}>
                        {keluar.length
                          ? keluar.map((k, ki) => (
                              <div key={ki} className="h-[16px] truncate leading-[16px]">
                                {k.qty ? `${k.pihak} (${k.qty})` : k.pihak}
                              </div>
                            ))
                          : '-'}
                      </td>
                      <td className={`${num} font-bold`}>{row.sisaStok}</td>
                      {!showMoney && (
                        <>
                          <td className={cell} />
                          <td className={cell} />
                        </>
                      )}
                      {showMoney && (
                        <>
                          <td className={num}>{formatRupiah(row.modalTersisa ?? 0)}</td>
                          <td className={num}>{formatRupiah(row.omzetTerjual ?? 0)}</td>
                          <td className={num}>{formatRupiah(row.untungTerjual ?? 0)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
                {/* Subtotal sisa per merk (sparepart gak dijumlah: satuan campur). */}
                <tr className="bg-gray-200 font-bold">
                  <td className={cell} colSpan={colsBeforeSisa}>
                    Total {g.label} ({g.rows.length} item)
                  </td>
                  <td className={num}>{g.label === SPAREPART_GROUP ? '' : g.totalSisa}</td>
                  <td className={cell} colSpan={showMoney ? 3 : 2} />
                </tr>
              </tbody>
            </table>

            {!showMoney && (
              <div className="mt-8 grid grid-cols-3 gap-10 text-center text-[12px]">
                {['Dicek oleh', 'Tanggal cek', 'Mengetahui'].map((label) => (
                  <div key={label}>
                    <p>{label}</p>
                    <p className="mt-10 border-t border-black pt-0.5">
                      {label === 'Tanggal cek' ? '____ / ____ / ________' : '( ........................................ )'}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Ringkasan keuangan (admin) cuma di lembar terakhir. */}
            {isLast && data.ringkasan && (
              <table className="mt-3 w-72 border-collapse border border-black text-[11px]">
                <tbody>
                  <tr>
                    <td className={`${cell} font-bold`}>Total Modal Tersisa</td>
                    <td className={num}>{formatRupiah(data.ringkasan.totalModalTersisa)}</td>
                  </tr>
                  <tr>
                    <td className={`${cell} font-bold`}>Total Omzet Terjual</td>
                    <td className={num}>{formatRupiah(data.ringkasan.totalOmzetTerjual)}</td>
                  </tr>
                  <tr>
                    <td className={`${cell} font-bold`}>Total Untung Terjual</td>
                    <td className={num}>{formatRupiah(data.ringkasan.totalUntungTerjual)}</td>
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
