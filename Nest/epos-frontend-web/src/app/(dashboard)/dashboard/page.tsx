import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Eye,
  FileBarChart,
  Package,
  ReceiptText,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateLong, formatDateTime, formatRupiah, statusLabel } from '@/lib/format';
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

const QUICK_ACTIONS = [
  { href: '/members', label: 'Cek Member', icon: Users },
  { href: '/master', label: 'Master Data', icon: Package },
  { href: '/laporan', label: 'Laporan', icon: FileBarChart },
  { href: '/teknisi/queue', label: 'Servis & Teknisi', icon: Wrench },
];

// Server Component: fetch langsung ke backend pas render pertama (lihat
// lib/server-api.ts). Update realtime sesudahnya nyusul lewat socket.io
// (job.status_changed dkk) begitu komponen client dashboard ditambah.
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
          <p className="mt-1 text-sm text-muted-foreground">{formatDateLong(new Date())}</p>
        </div>
        <Button asChild>
          <Link href="/pos">
            <ReceiptText className="size-4" />
            Transaksi Baru
          </Link>
        </Button>
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {greeting()}, {session.user.displayName}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sistem siap digunakan. Berikut ringkasan operasional hari ini.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-start gap-3">
            <span className="rounded-lg bg-secondary p-2 text-secondary-foreground">
              <BarChart3 className="size-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Transaksi Hari Ini</p>
              <p className="text-2xl font-bold">{summary.transaksiHariIni}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3">
            <span className="rounded-lg bg-secondary p-2 text-secondary-foreground">
              <Wallet className="size-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Omzet Hari Ini</p>
              <p className="text-2xl font-bold">{formatRupiah(summary.omzetHariIni)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3">
            <span className="rounded-lg bg-status-warning/15 p-2 text-status-warning">
              <Wrench className="size-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Job Servis Aktif</p>
              <p className="text-2xl font-bold">{totalJobAktif}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3">
            <span className="rounded-lg bg-destructive/10 p-2 text-destructive">
              <AlertCircle className="size-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Invoice Belum Lunas</p>
              <p className="text-2xl font-bold">{totalBelumLunas}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Transaksi Terkini</CardTitle>
            <Link
              href="/invoices"
              className="text-sm text-primary hover:underline"
            >
              Lihat Semua
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {summary.recentInvoices.length === 0 && (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Belum ada transaksi.</p>
            )}
            {summary.recentInvoices.length > 0 && (
              <div className="grid">
                {summary.recentInvoices.map((inv) => (
                  <Link
                    key={inv.id}
                    href={`/invoices/${inv.id}`}
                    className="flex items-center justify-between gap-3 border-t px-6 py-3 text-sm hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{inv.number}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {inv.customerName || inv.member?.name || '-'} •{' '}
                        {formatDateTime(inv.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge variant={invoiceStatusVariant(inv.status)}>
                        {statusLabel(inv.status)}
                      </Badge>
                      <span className="font-medium">{formatRupiah(inv.grandTotal)}</span>
                      <Eye className="size-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Invoice Belum Lunas</CardTitle>
            {totalBelumLunas > 0 && (
              <span className="flex size-6 items-center justify-center rounded-full bg-destructive text-xs font-medium text-white">
                {totalBelumLunas}
              </span>
            )}
          </CardHeader>
          <CardContent className="grid gap-3">
            {summary.recentUnpaidInvoices.length === 0 && (
              <p className="text-sm text-muted-foreground">Semua invoice lunas.</p>
            )}
            {summary.recentUnpaidInvoices.map((inv) => (
              <Link
                key={inv.id}
                href={`/invoices/${inv.id}`}
                className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {inv.customerName || inv.member?.name || '-'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{inv.number}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge variant={invoiceStatusVariant(inv.status)}>
                    {statusLabel(inv.status)}
                  </Badge>
                  <p className="mt-1 font-medium">{formatRupiah(inv.grandTotal)}</p>
                </div>
              </Link>
            ))}
            {summary.recentUnpaidInvoices.length > 0 && (
              <Button asChild variant="outline" size="sm" className="mt-1">
                <Link href="/invoices">
                  Lakukan Follow Up
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center hover:bg-accent"
          >
            <span className="rounded-full bg-secondary p-2.5 text-secondary-foreground">
              <action.icon className="size-5" />
            </span>
            <span className="text-sm font-medium">{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
