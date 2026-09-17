'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { optionalNumberField, trimmedOrUndefined } from '@/lib/form-number';
import type { Role } from '@/lib/session';
import { AcUnitDetailView, type AcUnitDetail } from '@/components/ac-unit-detail-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

// Sinkron sama AC_UNIT_STATUSES di backend (update-ac-unit.dto.ts).
const STATUS_OPTIONS = [
  { value: 'menunggu_pemasangan', label: 'Menunggu Pemasangan' },
  { value: 'aktif', label: 'Aktif' },
  { value: 'dalam_maintenance', label: 'Dalam Maintenance' },
];

const editSchema = z.object({
  brand: z.string().optional(),
  model: z.string().optional(),
  pk: optionalNumberField,
  roomLocation: z.string().optional(),
  serialNumber: z.string().optional(),
  status: z.enum(['menunggu_pemasangan', 'aktif', 'dalam_maintenance']),
  // <input type="date"> browser -> 'YYYY-MM-DD', dikirim apa adanya (backend
  // terima IsDateString). Field teks kosong = gak diubah (lihat
  // trimmedOrUndefined di mutationFn) — form ini BELUM bisa ngosongin
  // tanggal yang udah keisi, cuma ganti ke tanggal lain atau dibiarin.
  installationDate: z.string().optional(),
  lastServiceDate: z.string().optional(),
  nextServiceDate: z.string().optional(),
});
type EditFormValues = z.infer<typeof editSchema>;

// ISO datetime dari API ('2026-09-15T00:00:00.000Z') -> 'YYYY-MM-DD' buat
// value <input type="date">.
function toDateInputValue(v: string | null): string {
  return v ? v.slice(0, 10) : '';
}

export function AcUnitDetailClient({ unitId, role }: { unitId: string; role: Role }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ac-units', unitId],
    queryFn: () => apiClient.get<AcUnitDetail>(`/ac-units/${unitId}`),
  });

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      brand: '',
      model: '',
      pk: '',
      roomLocation: '',
      serialNumber: '',
      status: 'aktif',
      installationDate: '',
      lastServiceDate: '',
      nextServiceDate: '',
    },
  });

  function openEdit() {
    if (!data) return;
    const { unit } = data;
    form.reset({
      brand: unit.brand ?? '',
      model: unit.model ?? '',
      pk: unit.pk ?? '',
      roomLocation: unit.roomLocation ?? '',
      serialNumber: unit.serialNumber ?? '',
      status: (['menunggu_pemasangan', 'aktif', 'dalam_maintenance'] as const).includes(
        unit.status as 'menunggu_pemasangan' | 'aktif' | 'dalam_maintenance',
      )
        ? (unit.status as 'menunggu_pemasangan' | 'aktif' | 'dalam_maintenance')
        : 'aktif',
      installationDate: toDateInputValue(unit.installationDate),
      lastServiceDate: toDateInputValue(unit.lastServiceDate),
      nextServiceDate: toDateInputValue(unit.nextServiceDate),
    });
    setEditOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: (values: EditFormValues) =>
      apiClient.patch(`/ac-units/${unitId}`, {
        brand: trimmedOrUndefined(values.brand),
        model: trimmedOrUndefined(values.model),
        pk: values.pk?.trim() ? Number(values.pk) : undefined,
        roomLocation: trimmedOrUndefined(values.roomLocation),
        serialNumber: trimmedOrUndefined(values.serialNumber),
        status: values.status,
        installationDate: trimmedOrUndefined(values.installationDate),
        lastServiceDate: trimmedOrUndefined(values.lastServiceDate),
        nextServiceDate: trimmedOrUndefined(values.nextServiceDate),
      }),
    onSuccess: () => {
      toast.success('Data unit diperbarui.');
      queryClient.invalidateQueries({ queryKey: ['ac-units', unitId] });
      setEditOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan perubahan.');
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Memuat unit AC...</p>;
  if (isError || !data) {
    return <p className="text-sm text-destructive">Gagal memuat data unit AC.</p>;
  }

  return (
    <>
      <AcUnitDetailView data={data} onEdit={role === 'admin' ? openEdit : undefined} />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Data Unit</DialogTitle>
            <DialogDescription>
              Betulin data unit AC — barcode & pemilik gak bisa diubah dari sini.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              className="grid gap-4"
              onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="brand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Merek</FormLabel>
                      <FormControl>
                        <Input placeholder="Contoh: Daikin" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model/Tipe</FormLabel>
                      <FormControl>
                        <Input placeholder="Opsional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="pk"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kapasitas (PK)</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="1, 1.5, 2, dst" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="serialNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>No. Seri</FormLabel>
                      <FormControl>
                        <Input placeholder="Opsional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="roomLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lokasi Ruangan</FormLabel>
                    <FormControl>
                      <Input placeholder="Contoh: Kamar Utama" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="installationDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tgl. Pemasangan</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastServiceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Servis Terakhir</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nextServiceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Servis Berikutnya</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
