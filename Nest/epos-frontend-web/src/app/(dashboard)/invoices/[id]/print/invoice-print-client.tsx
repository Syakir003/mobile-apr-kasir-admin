'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { terbilangRupiah } from '@/lib/terbilang';
import { Button } from '@/components/ui/button';
import { FormSheet, HLine, Txt, VLine } from '@/components/form-sheet';

interface InvoiceItem {
  id: string;
  kind: string;
  refId: string | null;
  name: string;
  unit: string | null;
  qty: string;
  unitPrice: string;
  lineTotal: string;
}
interface InvoiceDetail {
  id: string;
  number: string;
  customerName: string | null;
  customerPhone: string | null;
  subtotal: string;
  discount: string;
  taxPercent: string;
  taxAmount: string;
  transportFee: string;
  grandTotal: string;
  totalPaid: string;
  status: string;
  notes: string | null;
  createdAt: string;
  items: InvoiceItem[];
  // Penyesuaian invoice: diskon ad-hoc/voucher (requestId null) dan tambahan
  // dari pengajuan sparepart teknisi (requestId terisi).
  adjustments?: { reason: string | null; amount: string; requestId: string | null }[];
  member: { address: string | null } | null;
}

// Satu baris pada tabel formulir: barang, atau rincian (diskon, pajak, ongkir).
interface Row {
  key: string;
  qty?: string;
  name: string;
  price?: string;
  total: string;
  italic?: boolean;
}

// Geometri formulir asli (Invoice-Contoh.jpeg, 1271x954). Area cetak diambil
// dari x=150..1230 dan y=36..930 (tanpa garis sobekan di sisi kiri).
const W = 1080;
const H = 894;
const OX = 149.5;
const OY = 35.2;
const ROWS_PER_PAGE = 10;
const TABLE_TOP = 268;
const HEAD_BOTTOM = 323;
const TABLE_BOTTOM = 676;
const ROW_H = (TABLE_BOTTOM - HEAD_BOTTOM) / ROWS_PER_PAGE;
const X = { left: 169, no: 210, qty: 309, name: 858, price: 1034, right: 1211 };

function formatDateDMY(value: string): string {
  const d = new Date(value);
  const two = (n: number) => n.toString().padStart(2, '0');
  return `${two(d.getDate())}-${two(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function trimZero(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : v;
}

export function InvoicePrintClient({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => apiClient.get<InvoiceDetail>(`/invoices/${invoiceId}`),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat invoice...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat invoice.</p>;

  // Rincian di bawah barang (diskon, pajak, ongkir, tambahan) supaya angka di
  // kertas SELALU cocok: barang + rincian = JUMLAH.
  const grand = Number(data.grandTotal);
  const discount = Number(data.discount);
  const tax = Number(data.taxAmount);
  const transport = Number(data.transportFee);
  const paid = Number(data.totalPaid);
  const sisa = Math.max(0, grand - paid);
  const tambahan = Math.round(grand - (Number(data.subtotal) - discount + tax + transport));
  const discountReason = (data.adjustments ?? [])
    .filter((a) => !a.requestId)
    .map((a) => a.reason)
    .filter(Boolean)
    .join(', ');

  const rows: Row[] = data.items.map((item) => ({
    key: item.id,
    qty: `${trimZero(item.qty)} ${item.unit ?? ''}`.trim(),
    name: `${item.name}${item.kind === 'product' && Number(item.lineTotal) === 0 ? ' (termasuk paket)' : ''}`,
    price: formatRupiah(item.unitPrice),
    total: formatRupiah(item.lineTotal),
  }));
  if (discount > 0) {
    rows.push({ key: 'diskon', name: `Diskon${discountReason ? ` (${discountReason})` : ''}`, total: `- ${formatRupiah(discount)}`, italic: true });
  }
  if (tax > 0) rows.push({ key: 'pajak', name: `Pajak (${trimZero(data.taxPercent)}%)`, total: formatRupiah(tax), italic: true });
  if (transport > 0) rows.push({ key: 'transport', name: 'Biaya transport', total: formatRupiah(transport), italic: true });
  if (tambahan !== 0) {
    rows.push({ key: 'tambahan', name: 'Tambahan sparepart (pengajuan teknisi)', total: formatRupiah(tambahan), italic: true });
  }

  // Lebih dari 10 baris = lanjut ke lembar berikutnya (total hanya di lembar terakhir).
  const pages: Row[][] = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE));

  const status =
    data.status === 'lunas'
      ? 'LUNAS'
      : paid > 0
        ? `${data.status === 'dp' ? 'DP' : 'DIBAYAR'}: ${formatRupiah(paid)}  •  SISA TAGIHAN: ${formatRupiah(sisa)}`
        : '';

  return (
    <div className="mx-auto max-w-[210mm]">
      {/* Kertas A4; lembar formulir mengisi lebar cetak dengan proporsi formulir asli. */}
      <style>{'@page { size: A4; margin: 12mm; } .invoice-page { break-after: page; } .invoice-page:last-child { break-after: auto; }'}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" asChild>
          <Link href="/pos">
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak Invoice
        </Button>
      </div>

      {pages.map((pageRows, pi) => {
        const last = pi === pages.length - 1;
        return (
          <div key={pi} className="invoice-page mb-6 print:mb-0">
            <FormSheet w={W} h={H} ox={OX} oy={OY}>
              {/* ---- kotak identitas toko ---- */}
              <HLine x1={169} x2={486} y={54.5} />
              <HLine x1={169} x2={486} y={212.5} />
              <VLine x={170} y1={54} y2={213} />
              <VLine x={485.5} y1={54} y2={213} t={1.5} />
              <Txt x={169} y={62} w={317} h={42} size={27} bold align="center">AYUB AC</Txt>
              <Txt x={169} y={103} w={317} h={22} size={15.5} bold align="center">Penjualan • Service • Spare Part • Rental AC</Txt>
              <Txt x={169} y={131} w={317} h={19} size={14.5} align="center">JL. GUNUNG ANYAR RT. 01 RW. 06</Txt>
              <Txt x={169} y={150} w={317} h={19} size={14.5} align="center">KEL. GUNUNG GEDANGAN - MOJOKERTO</Txt>
              <Txt x={169} y={169} w={317} h={19} size={14.5} align="center">TLP. : 0857 332 7112 - 0822 3388 9990</Txt>
              <Txt x={169} y={188} w={317} h={19} size={14.5} align="center">0321 - 325831</Txt>

              {/* ---- judul ---- */}
              <Txt x={500} y={125} w={240} h={50} size={36} bold align="center" spacing={3}>INVOICE</Txt>

              {/* ---- kotak NO / TGL / NAMA / ALAMAT / TLP ---- */}
              <HLine x1={766} x2={1211} y={54.5} />
              <HLine x1={766} x2={1211} y={99} t={1.5} />
              <HLine x1={766} x2={1211} y={131} t={1.5} />
              <HLine x1={766} x2={1211} y={163.5} />
              <HLine x1={866} x2={1211} y={195.5} />
              <HLine x1={766} x2={1211} y={227.5} />
              <HLine x1={766} x2={1211} y={259.5} />
              <VLine x={767} y1={54} y2={260} />
              <VLine x={866.5} y1={54} y2={260} />
              <VLine x={1210.5} y1={54} y2={260} />
              <Txt x={767} y={55} w={99} h={44} size={26} bold pad={14}>NO.</Txt>
              <Txt x={767} y={100} w={99} h={31} size={21} bold pad={14}>TGL.</Txt>
              <Txt x={767} y={132} w={99} h={31} size={21} bold pad={14}>NAMA</Txt>
              <Txt x={767} y={164} w={99} h={63} size={21} bold pad={14}>ALAMAT</Txt>
              <Txt x={767} y={228} w={99} h={32} size={21} bold pad={14}>TLP.</Txt>
              <Txt x={868} y={55} w={343} h={44} size={24} align="center">{data.number}</Txt>
              <Txt x={868} y={100} w={343} h={31} size={19} pad={12}>{formatDateDMY(data.createdAt)}</Txt>
              <Txt x={868} y={132} w={343} h={31} size={19} pad={12}>{data.customerName ?? ''}</Txt>
              <Txt x={868} y={164} w={343} h={63} size={18} pad={12} valign="top" lineHeight={22}>
                <span style={{ whiteSpace: 'normal', display: 'block', paddingTop: 5 }}>{data.member?.address ?? ''}</span>
              </Txt>
              <Txt x={868} y={228} w={343} h={32} size={19} pad={12}>{data.customerPhone ?? ''}</Txt>

              {/* ---- tabel barang ---- */}
              <HLine x1={169} x2={1211} y={TABLE_TOP + 0.5} />
              <HLine x1={169} x2={1211} y={HEAD_BOTTOM + 0.5} />
              {Array.from({ length: ROWS_PER_PAGE }).map((_, i) => (
                <HLine key={i} x1={169} x2={1211} y={HEAD_BOTTOM + (i + 1) * ROW_H} t={i === ROWS_PER_PAGE - 1 ? 2 : 1.5} />
              ))}
              <VLine x={X.left + 1} y1={TABLE_TOP} y2={911} />
              <VLine x={X.no + 0.5} y1={TABLE_TOP} y2={TABLE_BOTTOM} />
              <VLine x={X.qty} y1={TABLE_TOP} y2={TABLE_BOTTOM} t={1.5} />
              <VLine x={X.name + 0.5} y1={TABLE_TOP} y2={TABLE_BOTTOM} />
              <VLine x={X.price + 0.5} y1={TABLE_TOP} y2={711} />
              <VLine x={X.right - 0.5} y1={TABLE_TOP} y2={911} />
              <Txt x={X.left} y={TABLE_TOP} w={41} h={55} size={22} bold align="center">NO.</Txt>
              <Txt x={X.no} y={TABLE_TOP} w={99} h={55} size={21} bold align="center" lineHeight={23}>
                JUMLAH<br />BARANG
              </Txt>
              <Txt x={X.qty} y={TABLE_TOP} w={549} h={55} size={21} bold align="center" spacing={9}>KETERANGAN</Txt>
              <Txt x={X.name} y={TABLE_TOP} w={176} h={55} size={21} bold align="center" lineHeight={23}>
                HARGA<br />SATUAN
              </Txt>
              <Txt x={X.price} y={TABLE_TOP} w={177} h={55} size={22} bold align="center" spacing={4}>JUMLAH</Txt>

              {pageRows.map((r, i) => {
                const y = HEAD_BOTTOM + i * ROW_H;
                const startNo = pi * ROWS_PER_PAGE;
                const no = r.italic ? '' : String(startNo + i + 1);
                return (
                  <React.Fragment key={r.key}>
                    <Txt x={X.left} y={y} w={41} h={ROW_H} size={18} align="center">{no}</Txt>
                    <Txt x={X.no} y={y} w={99} h={ROW_H} size={18} align="center">{r.qty ?? ''}</Txt>
                    <Txt x={X.qty} y={y} w={549} h={ROW_H} size={18} pad={9}>
                      {r.italic ? <i>{r.name}</i> : r.name}
                    </Txt>
                    <Txt x={X.name} y={y} w={176} h={ROW_H} size={18} align="right" pad={10}>{r.price ?? ''}</Txt>
                    <Txt x={X.price} y={y} w={177} h={ROW_H} size={18} align="right" pad={10}>{r.total}</Txt>
                  </React.Fragment>
                );
              })}

              {/* ---- baris JUMLAH (+ status pembayaran di sisi kiri yang kosong) ---- */}
              <HLine x1={X.price} x2={1211} y={710.5} />
              {last ? (
                <>
                  {status && (
                    <Txt x={178} y={TABLE_BOTTOM + 1} w={700} h={34} size={19} bold>{status}</Txt>
                  )}
                  <Txt x={880} y={TABLE_BOTTOM + 1} w={150} h={34} size={23} bold align="right" spacing={4}>JUMLAH</Txt>
                  <Txt x={X.price} y={TABLE_BOTTOM + 1} w={177} h={34} size={20} bold align="right" pad={10}>{formatRupiah(data.grandTotal)}</Txt>
                </>
              ) : (
                <Txt x={178} y={TABLE_BOTTOM + 1} w={700} h={34} size={18}>(bersambung ke lembar berikutnya)</Txt>
              )}

              {/* ---- TERBILANG ---- */}
              <HLine x1={169} x2={1211} y={716.5} t={1.5} />
              <HLine x1={169} x2={1211} y={751.5} />
              <VLine x={170} y1={716} y2={752} />
              <VLine x={1210.5} y1={716} y2={752} />
              <Txt x={178} y={717} w={1030} h={34} size={23} bold>
                TERBILANG :&nbsp;
                <span style={{ fontWeight: 400, fontSize: '0.85em' }}>{last ? terbilangRupiah(grand) : ''}</span>
              </Txt>

              {/* ---- CATATAN + HORMAT KAMI ---- */}
              <HLine x1={169} x2={1211} y={758.5} t={1.5} />
              <HLine x1={169} x2={1211} y={910.5} />
              <VLine x={170} y1={758} y2={911} />
              <VLine x={897.5} y1={758} y2={911} />
              <VLine x={1210.5} y1={758} y2={911} />
              <Txt x={183} y={761} w={500} h={30} size={24} bold>CATATAN :</Txt>
              {(() => {
                const lines: { t: React.ReactNode }[] = [];
                if (data.notes) lines.push({ t: <>* Catatan transaksi: {data.notes}</> });
                lines.push({ t: <>* No. Laporan Pekerjaan : ......................................................................................</> });
                lines.push({ t: <>* Barang yang sudah dibeli tidak dapat ditukar atau dikembalikan</> });
                lines.push({ t: <>* Pembayaran dapat ditransfer ke Rek. <b>ANDRIAS WARDOYO BCA 0501826391</b></> });
                lines.push({ t: <>* Jangan memberi tip kepada petugas kami. Bayarlah sesuai jumlah diatas</> });
                lines.push({ t: <>* Suara Konsumen 082233889990. Pastikan Anda dilayani dengan baik</> });
                // 5 baris seperti formulir asli; bila ada catatan transaksi (6 baris) dirapatkan.
                const step = lines.length > 5 ? 19.5 : 23.5;
                const top = lines.length > 5 ? 789 : 788;
                return lines.map((l, i) => (
                  <Txt key={i} x={183} y={top + i * step} w={710} h={step} size={19.5}>
                    {l.t}
                  </Txt>
                ));
              })()}
              <Txt x={898} y={762} w={313} h={36} size={26} bold align="center">HORMAT KAMI</Txt>
            </FormSheet>
          </div>
        );
      })}
    </div>
  );
}
