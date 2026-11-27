import Link from 'next/link';
import { ReceiptText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PanelTitle, panelClass } from '@/components/ui/panel';
import { formatDateLong, formatDateTime, formatRupiah, statusLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { serverFetch, requireSession } from '@/lib/server-api';

// Restyle 2026-09 — sebelumnya cuma 4 kartu angka + 2 panel badge status
// (fungsional tapi gersang). Sekarang ikutin layout style guide Figma
// "DealDeck E-POS AC" (sidebar teal dkk di dashboard-shell.tsx udah lebih
// dulu port dari situ — token warnanya sudah ada di globals.css, halaman
// ini TINGGAL makan token yang sama, bukan bikin tema baru). Badge
// perbandingan "+12% vs Kemarin" ala prototype SENGAJA tidak diikutin —
// backend belum punya data pembanding hari sebelumnya, dan angka dummy di
// produksi lebih berbahaya daripada gak ada badge sama sekali.
interface InvoiceRowSummary {
  id: string;
  number: string;
  customerName: string | null;
  member: { name: string } | null;
  grandTotal: string;
  status: string;
  createdAt: string;
}
interface DashboardSummary {
  jobAktifPerStatus: { status: string; count: number }[];
  transaksiHariIni: number;
  omzetHariIni: number;
  invoiceBelumLunas: { status: string; count: number }[];
  recentInvoices: InvoiceRowSummary[];
  recentUnpaidInvoices: InvoiceRowSummary[];
}

function invoiceStatusVariant(status: string): 'success' | 'warning' | 'secondary' {
  if (status === 'lunas') return 'success';
  if (status === 'batal' || status === 'refund') return 'secondary';
  return 'warning';
}

// Sapaan berdasar jam WIB saat ini (bukan jam lokal proses Node) — dashboard
// ini murni tampilan, gak masalah kalau geser semenit dua menit kayak
// perhitungan uang/laporan, jadi cukup Intl.DateTimeFormat langsung di sini
// tanpa nge-share util WIB punya backend.
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  );
  if (hour < 11) return 'Selamat Pagi';
  if (hour < 15) return 'Selamat Siang';
  if (hour < 18) return 'Selamat Sore';
  return 'Selamat Malam';
}

/** Satu angka ringkasan hari ini: label di atas, angka di bawah (sama dengan strip di Detail Invoice). */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Baris invoice yang sama untuk kedua daftar (nomor + pelanggan + waktu di kiri, status + total di kanan). */
function InvoiceRow({ inv }: { inv: InvoiceRowSummary }) {
  return (
    <Link
      href={`/invoices/${inv.id}`}
      className="flex flex-col gap-2 border-t px-4 py-3 text-sm first:border-t-0 hover:bg-accent sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{inv.number}</p>
        <p className="truncate text-xs text-muted-foreground">
          {inv.customerName || inv.member?.name || '-'} • {formatDateTime(inv.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 max-sm:justify-between">
        <Badge variant={invoiceStatusVariant(inv.status)}>{statusLabel(inv.status)}</Badge>
        <span className="font-medium">{formatRupiah(inv.grandTotal)}</span>
      </div>
    </Link>
  );
}

// Server Component: fetch langsung ke backend pas render pertama (lihat
// lib/server-api.ts). Update realtime sesudahnya nyusul lewat socket.io
// (job.status_changed dkk) begitu komponen client dashboard ditambah.
//
// Tata letak: satu judul (sapaan ikut di baris tanggal), satu strip angka hari ini, lalu dua daftar yang memakai baris
// yang sama. Ubin "aksi cepat" dibuang karena menduplikasi menu sidebar (Member, Master Data, Laporan, Antrian Servis).
export default async function DashboardPage() {
  const [summary, session] = await Promise.all([
    serverFetch<DashboardSummary>('/dashboard/summary'),
    requireSession(),
  ]);
  const totalJobAktif = summary.jobAktifPerStatus.reduce((a, b) => a + b.count, 0);
  const totalBelumLunas = summary.invoiceBelumLunas.reduce((a, b) => a + b.count, 0);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {greeting()}, {session.user.displayName} {'•'} {formatDateLong(new Date())}
          </p>
        </div>
        <Button asChild>
          <Link href="/pos">
            <ReceiptText className="size-4" />
            Transaksi Baru
          </Link>
        </Button>
      </div>

      <dl
        className={cn(
          panelClass,
          'grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0',
        )}
      >
        <Stat label="Transaksi Hari Ini" value={summary.transaksiHariIni} />
        <Stat label="Omzet Hari Ini" value={formatRupiah(summary.omzetHariIni)} />
        <Stat label="Job Servis Aktif" value={totalJobAktif} />
        <Stat label="Invoice Belum Lunas" value={totalBelumLunas} />
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={panelClass}>
          <PanelTitle
            title="Transaksi Terkini"
            actions={
              <Link href="/invoices" className="text-sm font-normal text-primary hover:underline">
                Lihat Semua
              </Link>
            }
          />
          {summary.recentInvoices.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Belum ada transaksi.{' '}
              <Link href="/pos" className="text-primary underline">
                Buka Kasir (POS)
              </Link>{' '}
              untuk membuat transaksi pertama.
            </p>
          ) : (
            summary.recentInvoices.map((inv) => <InvoiceRow key={inv.id} inv={inv} />)
          )}
        </div>

        <div className={panelClass}>
          <PanelTitle title="Invoice Belum Lunas" count={totalBelumLunas} />
          {summary.recentUnpaidInvoices.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Semua invoice lunas.</p>
          ) : (
            <>
              {summary.recentUnpaidInvoices.map((inv) => (
                <InvoiceRow key={inv.id} inv={inv} />
              ))}
              <div className="border-t p-3">
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/invoices">Lakukan Follow Up</Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
