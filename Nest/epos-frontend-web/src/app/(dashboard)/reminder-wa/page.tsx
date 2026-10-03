'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MonitoringTab } from './monitoring-tab';

// Halaman "Pengingat WA" (admin) — tab Monitoring Jadwal (semua set AC,
// 2026-09-30) + tab Template Pesan (padanan reminder_template_screen.dart).

interface WaTemplateRow {
  kind: string;
  body: string;
  defaultBody: string;
  updatedAt: string | null;
}

const TEMPLATE_META: Record<string, { title: string; hint: string }> = {
  invoice: { title: 'Invoice', hint: 'Dikirim saat tombol "Kirim WA" di halaman detail invoice diklik.' },
  selesai_servis: { title: 'Selesai servis', hint: 'Dikirim otomatis begitu admin menyetujui job servis selesai.' },
  reminder_h3: { title: 'Pengingat 3 hari sebelum jatuh tempo', hint: 'Dikirim otomatis pukul 09.00 WIB.' },
  reminder_h7: { title: 'Pengingat 7 hari setelah jatuh tempo', hint: 'Dikirim otomatis pukul 09.00 WIB bila AC belum diservis.' },
};

// Placeholder yang SAH beda per kind — sinkron dengan PLACEHOLDERS_BY_KIND di
// backend (reminders.service.ts). 'invoice' gak ada {unit} (bisa macem-macem
// produk/jasa/sparepart campur), reminder gak ada {nomor}/{item}/{total}/
// {status} (belum tentu ada invoice yang relevan).
const PLACEHOLDERS_BY_KIND: Record<string, string[]> = {
  invoice: ['nama', 'nomor', 'tanggal', 'item', 'total', 'status'],
  selesai_servis: ['nama', 'unit', 'tanggal'],
  reminder_h3: ['nama', 'unit', 'tanggal'],
  reminder_h7: ['nama', 'unit', 'tanggal'],
};

// Data contoh dipakai buat preview — mencakup placeholder semua kind
// sekaligus (bukan cuma nama/unit/tanggal), biar template invoice juga
// kepreview beneran, bukan nampilin placeholder mentah.
const PREVIEW_SAMPLE: Record<string, string> = {
  nama: 'Budi Santoso',
  unit: '- Daikin 1 PK (Ruang Tamu)',
  tanggal: '15 Agustus 2026',
  nomor: 'INV-20260915-0007',
  item: '- Cuci AC 1 PK x1 = Rp150.000',
  total: 'Rp150.000',
  status: 'Lunas',
};

function previewText(body: string): string {
  let result = body;
  for (const [key, value] of Object.entries(PREVIEW_SAMPLE)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

export default function ReminderWaPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pengingat WA</h1>
        <p className="text-sm text-muted-foreground">
          Pantau jadwal servis tiap AC pelanggan. Setiap hari pukul 09.00 WIB sistem mengirim WhatsApp
          otomatis: 3 hari sebelum jatuh tempo, dan 7 hari setelah jatuh tempo bila belum diservis.
          Satu set AC (indoor + outdoor) dihitung satu pengingat.
        </p>
      </div>

      <Tabs defaultValue="monitoring">
        <TabsList>
          <TabsTrigger value="monitoring">Monitoring Jadwal</TabsTrigger>
          <TabsTrigger value="template">Template Pesan</TabsTrigger>
        </TabsList>
        <TabsContent value="monitoring" className="mt-4">
          <MonitoringTab />
        </TabsContent>
        <TabsContent value="template" className="mt-4">
          <TemplatePesanTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TemplatePesanTab() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['reminders', 'templates'],
    queryFn: () => apiClient.get<WaTemplateRow[]>('/reminders/templates'),
  });

  React.useEffect(() => {
    if (!query.data) return;
    setDrafts(Object.fromEntries(query.data.map((t) => [t.kind, t.body])));
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: (templates: Record<string, string>) =>
      apiClient.put('/reminders/templates', { templates }),
    onSuccess: () => {
      toast.success('Template pesan disimpan.');
      queryClient.invalidateQueries({ queryKey: ['reminders', 'templates'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan template.');
    },
  });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Memuat template...</p>;
  if (query.isError || !query.data) {
    return <p className="text-sm text-destructive">Gagal memuat template pesan.</p>;
  }

  const dirty = query.data.some((t) => (drafts[t.kind] ?? t.body) !== t.body);

  return (
    <div className="grid max-w-5xl gap-4">
      <p className="text-sm text-muted-foreground">
        Pesan boleh memakai isian dalam kurung kurawal, misalnya {'{nama}'}. Pakai hanya isian yang
        tercantum di tiap kartu, isian lain ditolak saat disimpan. Perubahan hanya berlaku untuk
        pesan berikutnya, pesan yang sudah terkirim tidak ikut berubah.
      </p>
      {query.data.map((tmpl) => {
        const body = drafts[tmpl.kind] ?? tmpl.body;
        const placeholders = PLACEHOLDERS_BY_KIND[tmpl.kind] ?? [];
        return (
          <Card key={tmpl.kind}>
            <CardHeader>
              <CardTitle className="text-base">{TEMPLATE_META[tmpl.kind]?.title ?? tmpl.kind}</CardTitle>
              <CardDescription>{TEMPLATE_META[tmpl.kind]?.hint}</CardDescription>
              {placeholders.length > 0 && (
                <CardDescription>
                  Isian yang boleh dipakai:{' '}
                  {placeholders.map((p) => (
                    <code key={p} className="mr-1 rounded bg-muted px-1">{`{${p}}`}</code>
                  ))}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="grid gap-3 xl:grid-cols-2">
              <Textarea
                rows={8}
                className="h-full min-h-40 font-mono text-sm"
                value={body}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [tmpl.kind]: e.target.value }))}
              />
              <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Contoh pesan yang diterima pelanggan</p>
                {previewText(body)}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-fit xl:col-span-2"
                onClick={() => setDrafts((prev) => ({ ...prev, [tmpl.kind]: tmpl.defaultBody }))}
              >
                Reset ke bawaan
              </Button>
            </CardContent>
          </Card>
        );
      })}
      {/* Bilah simpan selalu terlihat di bawah layar (daftar template panjang). */}
      <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
        <span className="text-sm text-muted-foreground">
          {dirty ? 'Ada perubahan yang belum disimpan.' : 'Semua perubahan sudah tersimpan.'}
        </span>
        <Button onClick={() => saveMutation.mutate(drafts)} disabled={saveMutation.isPending || !dirty}>
          {saveMutation.isPending ? 'Menyimpan...' : 'Simpan Template'}
        </Button>
      </div>
    </div>
  );
}
