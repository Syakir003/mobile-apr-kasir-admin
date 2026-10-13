'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Box, FormSheet, HLine, Txt, VLine } from '@/components/form-sheet';

interface InvoiceItem {
  id: string;
  kind: string;
  name: string;
  unit: string | null;
  qty: string;
}
interface ServiceOrderDetail {
  id: string;
  type: string;
  member: { name: string; phone: string | null; address: string | null } | null;
  // Unit AC yang dipasang (lokasi ruangan) — hanya untuk order pemasangan.
  serviceOrderUnits?: { unit: { roomLocation: string | null } | null }[];
  invoice: {
    id: string;
    number: string;
    createdAt: string;
    customerName: string | null;
    customerPhone: string | null;
    items: InvoiceItem[];
  } | null;
}

// Geometri formulir asli (surat-jalan-contoh.jpeg, 854x1280): dua salinan dalam
// satu lembar. Salinan atas dan bawah sedikit berbeda (letak judul "SURAT JALAN"
// dan awal tabel), jadi tiap salinan punya koordinat sendiri.
const W = 730;
const H = 1230;
const OX = 100;
const OY = 25;
const ROWS_PER_COPY = 14;
const COLS = { left: 114, no: 149.5, qty: 311.5, right: 813.5 };

const COPIES = {
  A: { head: 37, tableTop: 192.5, headBottom: 219.5, tableBottom: 528.5, sign: 537, title: 'bawah-kop' },
  B: { head: 676, tableTop: 811, headBottom: 836, tableBottom: 1168, sign: 1177, title: 'kanan' },
} as const;

function trimZero(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : v;
}

function formatDateDMY(value: string): string {
  const d = new Date(value);
  const two = (n: number) => n.toString().padStart(2, '0');
  return `${two(d.getDate())}-${two(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function DeliveryNotePrintClient({ serviceOrderId }: { serviceOrderId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['service-orders', serviceOrderId],
    queryFn: () => apiClient.get<ServiceOrderDetail>(`/service-orders/${serviceOrderId}`),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat surat jalan...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat surat jalan.</p>;

  if (!data.invoice) {
    return (
      <div className="p-6">
        <Button variant="ghost" asChild className="mb-4">
          <Link href="/pos">
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          Order ini tidak punya invoice terkait (bukan dari transaksi POS) - surat jalan cuma
          berlaku untuk pengiriman barang hasil pembelian, jadi tidak ada yang bisa dicetak.
        </p>
      </div>
    );
  }

  const barang = data.invoice.items.filter((i) => i.kind !== 'service');
  const info = {
    number: data.invoice.number,
    name: data.invoice.customerName ?? data.member?.name ?? '',
    phone: data.invoice.customerPhone ?? data.member?.phone ?? '',
    address: data.member?.address ?? '',
    date: formatDateDMY(data.invoice.createdAt),
    // Lokasi pemasangan (ruangan unit AC) bila order ini pemasangan.
    pasang:
      data.type === 'pemasangan'
        ? (data.serviceOrderUnits ?? []).map((u) => u.unit?.roomLocation).filter(Boolean).join(', ')
        : '',
  };

  // Lebih dari 14 barang = lembar berikutnya.
  const pages: InvoiceItem[][] = [];
  for (let i = 0; i < Math.max(barang.length, 1); i += ROWS_PER_COPY) pages.push(barang.slice(i, i + ROWS_PER_COPY));

  return (
    <div className="mx-auto max-w-[210mm]">
      <style>{'@page { size: A4; margin: 10mm; } .sj-page { break-after: page; } .sj-page:last-child { break-after: auto; }'}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" asChild>
          <Link href="/pos">
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak Surat Jalan
        </Button>
      </div>

      {pages.map((pageRows, pi) => (
        // Lebar dibatasi supaya satu lembar (dua salinan) muat di tinggi A4.
        <div key={pi} className="sj-page mx-auto mb-6 print:mb-0" style={{ width: 'min(100%, calc(268mm * 730 / 1230))' }}>
          <FormSheet w={W} h={H} ox={OX} oy={OY}>
            <Copy kind="A" rows={pageRows} startNo={pi * ROWS_PER_COPY} info={info} label="Lembar 1: Pelanggan" />
            <Copy kind="B" rows={pageRows} startNo={pi * ROWS_PER_COPY} info={info} label="Lembar 2: Arsip" />
          </FormSheet>
        </div>
      ))}
    </div>
  );
}

function Copy({
  kind,
  rows,
  startNo,
  info,
  label,
}: {
  kind: 'A' | 'B';
  rows: InvoiceItem[];
  startNo: number;
  info: { number: string; name: string; phone: string; address: string; date: string; pasang: string };
  label: string;
}) {
  const g = COPIES[kind];
  const rowH = (g.tableBottom - g.headBottom) / ROWS_PER_COPY;
  const hb = g.head; // atas kotak kop
  // Garis titik "Kepada Yth." mengikuti posisi kop (5 garis, jarak sesuai formulir).
  const dots = [27, 53, 75, 95, 116].map((d) => hb + d);

  return (
    <>
      {/* ---- kop: kotak + logo APR + identitas ---- */}
      <HLine x1={114} x2={458} y={hb + 0.5} t={1} />
      <HLine x1={114} x2={458} y={hb + 107} t={1} />
      <VLine x={114.5} y1={hb} y2={hb + 107} t={1} />
      <VLine x={457.5} y1={hb} y2={hb + 107} t={1} />
      <Box x={122} y={hb + 33} w={90} h={44}>
        {/* Logo APR seperti pada formulir surat jalan asli */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-apr.png" alt="APR" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </Box>
      <Txt x={222} y={hb + 8} w={232} h={26} size={19.5} bold align="center">CV. AYUB PODO RUKUN</Txt>
      <Txt x={222} y={hb + 34} w={232} h={15} size={11.5} bold align="center">Penjualan • Service • Spare Part • Rental AC</Txt>
      <Txt x={222} y={hb + 51} w={232} h={14} size={9.6} align="center">JL. GUNUNG ANYAR RT. 01 RW. 06</Txt>
      <Txt x={222} y={hb + 65} w={232} h={14} size={9.6} align="center">KEL. GUNUNG GEDANGAN - MOJOKERTO</Txt>
      <Txt x={222} y={hb + 79} w={232} h={14} size={9.6} align="center">TLP. : 0857 332 7112 - 0822 3388 9990</Txt>
      <Txt x={222} y={hb + 93} w={232} h={14} size={9.6} align="center">FAX. : (0321) 325831</Txt>

      {/* ---- Kepada Yth. + garis titik ---- */}
      <Txt x={560} y={hb + 33} w={92} h={20} size={14.5}>Kepada Yth. :</Txt>
      {dots.map((y, i) => (
        <HLine key={i} x1={i === 0 ? 676 : 652} x2={813} y={y} t={1} dotted />
      ))}
      <Txt x={654} y={dots[1] - 19} w={159} h={19} size={13.5} bold>{info.name}</Txt>
      <Txt x={654} y={dots[2] - 19} w={159} h={19} size={11}>{info.address}</Txt>
      <Txt x={654} y={dots[4] - 19} w={159} h={19} size={11}>{info.phone ? `Tlp. ${info.phone}` : ''}</Txt>

      {/* ---- judul: salinan atas di bawah kop, salinan bawah di sisi kanan kop ---- */}
      {g.title === 'bawah-kop' ? (
        <>
          <Txt x={123} y={hb + 120} w={430} h={24} size={21} bold>
            SURAT JALAN :&nbsp;&nbsp;<span style={{ fontSize: '0.88em' }}>No. {info.number}</span>
          </Txt>
          <Txt x={560} y={hb + 120} w={253} h={24} size={11.5} align="right">
            Tanggal : {info.date} <span style={{ color: '#666' }}>&nbsp;({label})</span>
          </Txt>
        </>
      ) : (
        <>
          <Txt x={492} y={hb + 67} w={165} h={24} size={21} bold>SURAT JALAN</Txt>
          <Txt x={492} y={hb + 91} w={165} h={22} size={15.5} bold>No. {info.number}</Txt>
          {/* di bawah kop (kiri), supaya tidak menimpa baris telepon di kanan */}
          <Txt x={123} y={hb + 110} w={330} h={22} size={11.5}>
            Tanggal : {info.date} <span style={{ color: '#666' }}>&nbsp;({label})</span>
          </Txt>
        </>
      )}

      {/* ---- tabel barang ---- */}
      <HLine x1={114} x2={814} y={g.tableTop} t={1} />
      {kind === 'A' && <HLine x1={114} x2={814} y={g.tableTop + 2} t={2} />}
      <HLine x1={114} x2={814} y={g.headBottom} t={kind === 'A' ? 1 : 2} />
      {Array.from({ length: ROWS_PER_COPY }).map((_, i) => (
        <HLine
          key={i}
          x1={114}
          x2={814}
          y={g.headBottom + (i + 1) * rowH}
          t={i === ROWS_PER_COPY - 1 ? 2 : 1}
        />
      ))}
      <VLine x={COLS.left + 0.5} y1={g.tableTop} y2={g.tableBottom} t={1} />
      <VLine x={COLS.no} y1={g.tableTop} y2={g.tableBottom} t={1} />
      <VLine x={COLS.qty} y1={g.tableTop} y2={g.tableBottom} t={1} />
      <VLine x={COLS.right} y1={g.tableTop} y2={g.tableBottom} t={1} />
      <Txt x={COLS.left} y={g.tableTop + 2} w={35} h={g.headBottom - g.tableTop - 2} size={15.5} bold align="center">NO.</Txt>
      <Txt x={COLS.no} y={g.tableTop + 2} w={162} h={g.headBottom - g.tableTop - 2} size={15.5} bold align="center">BANYAKNYA</Txt>
      <Txt x={COLS.qty} y={g.tableTop + 2} w={502} h={g.headBottom - g.tableTop - 2} size={15.5} bold align="center">NAMA BARANG</Txt>
      {rows.map((item, i) => {
        const y = g.headBottom + i * rowH;
        return (
          <React.Fragment key={item.id}>
            <Txt x={COLS.left} y={y} w={35} h={rowH} size={13.5} align="center">{startNo + i + 1}</Txt>
            <Txt x={COLS.no} y={y} w={162} h={rowH} size={13.5} align="center">
              {trimZero(item.qty)} {item.unit ?? ''}
            </Txt>
            <Txt x={COLS.qty} y={y} w={502} h={rowH} size={13.5} pad={8}>{item.name}</Txt>
          </React.Fragment>
        );
      })}

      {/* ---- keterangan pemasangan + tanda tangan ---- */}
      {info.pasang && (
        <Txt x={COLS.qty + 1} y={g.tableBottom + 2} w={502} h={12} size={10}>Pemasangan di : {info.pasang}</Txt>
      )}
      <Txt x={250} y={g.sign + 8} w={150} h={19} size={15.5} bold align="center">Tanda Terima,</Txt>
      <Txt x={552} y={g.sign + 8} w={150} h={19} size={15.5} bold align="center">Hormat Kami,</Txt>
      <HLine x1={240} x2={390} y={g.sign + 64} t={1} dotted />
      <HLine x1={540} x2={690} y={g.sign + 64} t={1} dotted />
    </>
  );
}
