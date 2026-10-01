'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { requiredNumberField } from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
  FormMessage,
} from '@/components/ui/form';
import { ResetScopeDialog } from '@/components/pengaturan/reset-scope-dialog';

// Padanan RESET_SCOPES/RESET_CONFIRM_TEXT backend
// (src/system-reset/dto/reset-database.dto.ts) — sengaja di-hardcode
// duplikat di sini, gak ada package shared antara backend & frontend.
// Kalau frasa di salah satu sisi diubah, sisi lain WAJIB disamain manual.
type ResetScope = 'transaksi' | 'transaksi_pelanggan' | 'total';

interface ResetScopeConfig {
  scope: ResetScope;
  title: string;
  buttonLabel: string;
  description: string;
  dataList: string[];
  confirmPhrase: string;
}

const RESET_SCOPE_CONFIGS: ResetScopeConfig[] = [
  {
    scope: 'transaksi',
    title: 'Reset Transaksi',
    buttonLabel: 'Reset Transaksi',
    description:
      'Hapus semua riwayat transaksi & servis. Data pelanggan, unit AC, dan Master Data (Produk/Sparepart/Jasa/Paket) TETAP AMAN.',
    dataList: [
      'Transaksi POS, invoice, pembayaran manual, adjustment invoice',
      'Servis: order, job teknisi, foto, temuan, pengajuan sparepart',
      'Shift kasir, riwayat mutasi stok, notifikasi, log WhatsApp, voucher',
      'Log audit lama (satu baris baru dicatat otomatis buat reset ini sendiri)',
      'Nomor urut invoice (mulai dari 0001 lagi)',
    ],
    confirmPhrase: 'HAPUS TRANSAKSI',
  },
  {
    scope: 'transaksi_pelanggan',
    title: 'Reset Transaksi + Pelanggan',
    buttonLabel: 'Reset Transaksi + Pelanggan',
    description:
      'Sama seperti Reset Transaksi, DITAMBAH semua data pelanggan (Member) & unit AC-nya. Master Data (Produk/Sparepart/Jasa/Paket) TETAP AMAN.',
    dataList: [
      'Semua yang dihapus di "Reset Transaksi"',
      'Data pelanggan (Member) beserta unit AC yang terdaftar',
      'Nomor urut barcode unit AC (mulai dari 0001 lagi)',
    ],
    confirmPhrase: 'HAPUS TRANSAKSI PELANGGAN',
  },
  {
    scope: 'total',
    title: 'Reset Total',
    buttonLabel: 'Reset Total',
    description:
      'Hapus SEMUA data bisnis — transaksi, pelanggan, DAN seluruh Master Data (Produk/Sparepart/Jasa/Paket). Cuma akun pengguna & pengaturan sistem yang tersisa.',
    dataList: [
      'Semua yang dihapus di "Reset Transaksi + Pelanggan"',
      'Master Data: Produk, Sparepart, Jasa, Paket Instalasi (+ isinya)',
      'Kategori masalah servis, riwayat harga modal (batch)',
      'Nomor urut SKU produk (mulai dari 0001 lagi)',
    ],
    confirmPhrase: 'HAPUS TOTAL',
  },
];

// Padanan AppConfig backend (app-config.service.ts) — 4 key baku, GET
// dibuka semua role (kasir/teknisi juga baca ini buat prefill), PUT
// admin-only per key. Kalau row belum pernah diisi, backend fallback ke
// DEFAULT_CONFIG-nya sendiri, jadi form ini SELALU dapat nilai (gak pernah
// kosong/undefined).
interface AppConfig {
  default_tax_percent: string;
  invoice_footer_note: string;
  printer_name: string;
  invoice_number_format: string;
}

const settingsSchema = z.object({
  default_tax_percent: requiredNumberField('Wajib diisi, berupa angka').refine(
    (v) => Number(v) >= 0 && Number(v) <= 100,
    'Harus 0-100',
  ),
  invoice_footer_note: z.string().optional(),
  printer_name: z.string().optional(),
  invoice_number_format: z.string().min(1, 'Wajib diisi'),
});
type SettingsValues = z.infer<typeof settingsSchema>;

export default function PengaturanPage() {
  const queryClient = useQueryClient();

  const [resetDialogScope, setResetDialogScope] = React.useState<ResetScope | null>(null);

  const resetMutation = useMutation({
    mutationFn: (payload: { scope: ResetScope; confirmText: string }) =>
      apiClient.post<{ scope: ResetScope; deletedCounts: Record<string, number> }>(
        '/system-reset',
        payload,
      ),
    onSuccess: (result) => {
      const total = Object.values(result.deletedCounts).reduce((sum, n) => sum + n, 0);
      toast.success(`Reset berhasil — ${total} baris data terhapus.`);
      setResetDialogScope(null);
      // Data yang kehapus nyebar ke hampir semua query di aplikasi (invoice,
      // member, produk, dst) — bukan cuma app-config. Clear semua cache biar
      // halaman lain gak nampilin data basi yang udah gak ada di database.
      queryClient.clear();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mereset database.');
    },
  });

  const activeResetConfig = RESET_SCOPE_CONFIGS.find((c) => c.scope === resetDialogScope) ?? null;

  const configQuery = useQuery({
    queryKey: ['app-config'],
    queryFn: () => apiClient.get<AppConfig>('/app-config'),
  });

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    // defaultValues bikin tiap field controlled dari awal (string kosong)
    // sebelum data API kelar di-fetch — `values` di bawah nanti nge-sync
    // pas data-nya dateng. Tanpa ini, field mulai dari `undefined`
    // (uncontrolled) terus pindah ke defined (controlled) begitu
    // configQuery.data kelar, yang mancing warning "changing an
    // uncontrolled input to be controlled" dari React.
    defaultValues: {
      default_tax_percent: '',
      invoice_footer_note: '',
      printer_name: '',
      invoice_number_format: '',
    },
    values: configQuery.data
      ? {
          default_tax_percent: configQuery.data.default_tax_percent,
          invoice_footer_note: configQuery.data.invoice_footer_note,
          printer_name: configQuery.data.printer_name,
          invoice_number_format: configQuery.data.invoice_number_format,
        }
      : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: SettingsValues) => {
      // Gak ada endpoint "update semua sekaligus" — PUT satu-satu per key,
      // sama seperti AppConfigController (PUT /app-config/:key).
      const entries = Object.entries(values) as [keyof AppConfig, string][];
      for (const [key, value] of entries) {
        await apiClient.put(`/app-config/${key}`, { value: value ?? '' });
      }
    },
    onSuccess: () => {
      toast.success('Pengaturan disimpan.');
      queryClient.invalidateQueries({ queryKey: ['app-config'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan pengaturan.');
    },
  });

  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pengaturan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Konfigurasi umum yang dipakai di seluruh aplikasi (POS, invoice, struk).
        </p>
      </div>

      {configQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {configQuery.isError && (
        <p className="text-sm text-destructive">Gagal memuat pengaturan.</p>
      )}

      {configQuery.data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Umum</CardTitle>
            <CardDescription>
              Perubahan langsung berlaku untuk transaksi/invoice baru — bukan yang sudah ada.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                className="grid gap-4"
                onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
              >
                <FormField
                  control={form.control}
                  name="default_tax_percent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pajak Default (%)</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" {...field} />
                      </FormControl>
                      <FormDescription>Prefill kolom pajak di form checkout POS.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="invoice_number_format"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Format Nomor Invoice</FormLabel>
                      <FormControl>
                        <Input placeholder="INV-{YYYYMMDD}-{SEQ}" {...field} />
                      </FormControl>
                      <FormDescription>
                        Referensi saja untuk saat ini — nomor invoice tetap digenerate backend
                        dengan pola <code>INV-YYYYMMDD-SEQ</code>.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="printer_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nama Printer Struk</FormLabel>
                      <FormControl>
                        <Input placeholder="Opsional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="invoice_footer_note"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Catatan Footer Invoice</FormLabel>
                      <FormControl>
                        <Textarea rows={3} placeholder="Opsional, mis. Terima kasih!" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={saveMutation.isPending} className="w-fit">
                  {saveMutation.isPending ? 'Menyimpan...' : 'Simpan Pengaturan'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Zona Bahaya — Reset Database</CardTitle>
          <CardDescription>
            Hapus data secara permanen. Cuma admin yang bisa akses bagian ini — pastikan kamu
            paham betul cakupan tiap tombol sebelum lanjut, gak ada fitur backup otomatis.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {RESET_SCOPE_CONFIGS.map((config) => (
            <div
              key={config.scope}
              className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="grid gap-1">
                <p className="text-sm font-medium">{config.title}</p>
                <p className="text-sm text-muted-foreground">{config.description}</p>
              </div>
              <Button
                variant="destructive"
                className="w-fit shrink-0"
                onClick={() => setResetDialogScope(config.scope)}
              >
                {config.buttonLabel}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {activeResetConfig && (
        <ResetScopeDialog
          open={resetDialogScope !== null}
          onOpenChange={(open) => {
            if (!open) setResetDialogScope(null);
          }}
          title={activeResetConfig.title}
          dataList={activeResetConfig.dataList}
          confirmPhrase={activeResetConfig.confirmPhrase}
          isPending={resetMutation.isPending}
          onConfirm={() =>
            resetMutation.mutate({
              scope: activeResetConfig.scope,
              confirmText: activeResetConfig.confirmPhrase,
            })
          }
        />
      )}
    </div>
  );
}
