import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatRupiah, statusLabel } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';

interface DashboardSummary {
  jobAktifPerStatus: { status: string; count: number }[];
  transaksiHariIni: number;
  omzetHariIni: number;
  invoiceBelumLunas: { status: string; count: number }[];
}

// Server Component: fetch langsung ke backend pas render pertama (lihat
// lib/server-api.ts). Update realtime sesudahnya nyusul lewat socket.io
// (job.status_changed dkk) begitu komponen client dashboard ditambah.
export default async function DashboardPage() {
  const summary = await serverFetch<DashboardSummary>('/dashboard/summary');
  const totalJobAktif = summary.jobAktifPerStatus.reduce((a, b) => a + b.count, 0);
  const totalBelumLunas = summary.invoiceBelumLunas.reduce((a, b) => a + b.count, 0);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Ringkasan operasional hari ini.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Transaksi Hari Ini
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.transaksiHariIni}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Omzet Hari Ini
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatRupiah(summary.omzetHariIni)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Job Servis Aktif
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalJobAktif}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Invoice Belum Lunas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalBelumLunas}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Job Aktif per Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {summary.jobAktifPerStatus.length === 0 && (
              <p className="text-sm text-muted-foreground">Tidak ada job aktif.</p>
            )}
            {summary.jobAktifPerStatus.map((j) => (
              <Badge key={j.status} variant="secondary">
                {statusLabel(j.status)}: {j.count}
              </Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice Belum Lunas per Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {summary.invoiceBelumLunas.length === 0 && (
              <p className="text-sm text-muted-foreground">Semua invoice lunas.</p>
            )}
            {summary.invoiceBelumLunas.map((i) => (
              <Badge key={i.status} variant="warning">
                {statusLabel(i.status)}: {i.count}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
