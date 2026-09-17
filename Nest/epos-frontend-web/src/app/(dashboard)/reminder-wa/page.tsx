'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// Halaman "Pengingat WA" (admin) — Siklus WA/Fonnte. Gabungan padanan
// reminder_settings_screen.dart (tab Pengaturan Siklus) + reminder_template_
// screen.dart (tab Template Pesan) di app mobile, jadi 1 halaman 2 tab di web.

const JOB_TYPE_LABEL: Record<string, string> = {
  cuci: 'Cuci AC',
  maintenance: 'Maintenance',
};

interface ReminderSettingRow {
  jobType: string;
  intervalDays: number;
  active: boolean;
  updatedAt: string | null;
}

interface WaTemplateRow {
  kind: string;
  body: string;
  defaultBody: string;
  updatedAt: string | null;
}

const TEMPLATE_LABEL: Record<string, string> = {
  invoice: 'Invoice (dikirim tiap tombol "Kirim WA" di halaman detail invoice)',
  selesai_servis: 'Selesai Servis',
  reminder_h3: 'Pengingat H-3 (3 hari sebelum jatuh tempo)',
  reminder_h7: 'Pengingat H+7 (7 hari lewat jatuh tempo)',
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
          Siklus servis otomatis (H-3, H+7, konfirmasi selesai) dikirim lewat Fonnte tiap jam
          09:00 WIB — halaman ini atur siklus dan redaksi pesannya.
        </p>
      </div>

      <Tabs defaultValue="pengaturan">
        <TabsList>
          <TabsTrigger value="pengaturan">Pengaturan Siklus</TabsTrigger>
          <TabsTrigger value="template">Template Pesan</TabsTrigger>
        </TabsList>
        <TabsContent value="pengaturan" className="mt-4">
          <PengaturanSiklusTab />
        </TabsContent>
        <TabsContent value="template" className="mt-4">
          <TemplatePesanTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PengaturanSiklusTab() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = React.useState<Record<string, { intervalDays: string; active: boolean }>>({});

  const query = useQuery({
    queryKey: ['reminders', 'settings'],
    queryFn: () => apiClient.get<ReminderSettingRow[]>('/reminders/settings'),
  });

  React.useEffect(() => {
    if (!query.data) return;
    setDrafts(
      Object.fromEntries(
        query.data.map((s) => [s.jobType, { intervalDays: String(s.intervalDays), active: s.active }]),
      ),
    );
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.put('/reminders/settings', {
        settings: Object.entries(drafts).map(([jobType, v]) => ({
          jobType,
          intervalDays: Number(v.intervalDays),
          active: v.active,
        })),
      }),
    onSuccess: () => {
      toast.success('Pengaturan siklus disimpan.');
      queryClient.invalidateQueries({ queryKey: ['reminders', 'settings'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan pengaturan.');
    },
  });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Memuat pengaturan...</p>;
  if (query.isError || !query.data) {
    return <p className="text-sm text-destructive">Gagal memuat pengaturan siklus.</p>;
  }

  return (
    <div className="grid max-w-xl gap-4">
      {query.data.map((setting) => {
        const draft = drafts[setting.jobType] ?? { intervalDays: '', active: true };
        return (
          <Card key={setting.jobType}>
            <CardHeader>
              <CardTitle className="text-base">{JOB_TYPE_LABEL[setting.jobType] ?? setting.jobType}</CardTitle>
              <CardDescription>
                Berapa hari setelah job jenis ini selesai, unit dijadwalkan servis berikutnya.
                Ganti angka ini TIDAK menggeser jadwal unit yang sudah terlanjur ditentukan —
                cuma berlaku untuk servis berikutnya.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={7}
                  max={730}
                  className="w-28"
                  value={draft.intervalDays}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [setting.jobType]: { ...draft, intervalDays: e.target.value },
                    }))
                  }
                />
                <span className="text-sm text-muted-foreground">hari</span>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.active}
                  onCheckedChange={(checked) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [setting.jobType]: { ...draft, active: checked === true },
                    }))
                  }
                />
                Aktif (kalau dimatikan, unit jenis ini tidak pernah dijadwalkan ulang otomatis)
              </label>
            </CardContent>
          </Card>
        );
      })}
      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="w-fit">
        {saveMutation.isPending ? 'Menyimpan...' : 'Simpan Pengaturan'}
      </Button>
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

  return (
    <div className="grid max-w-2xl gap-4">
      <p className="text-sm text-muted-foreground">
        Tiap jenis pesan punya placeholder sendiri (lihat di bawah tiap kartu) — pakai cuma yang
        tercantum, keyword lain akan ditolak saat disimpan. Mengganti template cuma berlaku untuk
        pesan berikutnya — pesan yang sudah terkirim tidak ikut berubah.
      </p>
      {query.data.map((tmpl) => {
        const body = drafts[tmpl.kind] ?? tmpl.body;
        const placeholders = PLACEHOLDERS_BY_KIND[tmpl.kind] ?? [];
        return (
          <Card key={tmpl.kind}>
            <CardHeader>
              <CardTitle className="text-base">{TEMPLATE_LABEL[tmpl.kind] ?? tmpl.kind}</CardTitle>
              {placeholders.length > 0 && (
                <CardDescription>
                  Placeholder:{' '}
                  {placeholders.map((p) => (
                    <code key={p} className="mr-1 rounded bg-muted px-1">{`{${p}}`}</code>
                  ))}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="grid gap-3">
              <Textarea
                rows={6}
                value={body}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [tmpl.kind]: e.target.value }))}
              />
              <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Preview (data contoh)</p>
                {previewText(body)}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setDrafts((prev) => ({ ...prev, [tmpl.kind]: tmpl.defaultBody }))}
              >
                Reset ke bawaan
              </Button>
            </CardContent>
          </Card>
        );
      })}
      <Button
        onClick={() => saveMutation.mutate(drafts)}
        disabled={saveMutation.isPending}
        className="w-fit"
      >
        {saveMutation.isPending ? 'Menyimpan...' : 'Simpan Template'}
      </Button>
    </div>
  );
}
