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
    </div>
  );
}
