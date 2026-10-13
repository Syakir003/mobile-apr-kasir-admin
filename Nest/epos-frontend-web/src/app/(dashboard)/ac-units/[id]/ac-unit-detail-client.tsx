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
import { ReminderScheduleFields, intervalError } from '@/components/reminder-schedule-fields';
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
  { value: 'menunggu_data', label: 'Menunggu Data (QR dulu)' },
  { value: 'rusak', label: 'Rusak' },
  { value: 'nonaktif', label: 'Nonaktif' },
];

const editSchema = z.object({
  brand: z.string().optional(),
  model: z.string().optional(),
  pk: optionalNumberField,
  roomLocation: z.string().optional(),
  serialNumber: z.string().optional(),
  status: z.enum(['menunggu_pemasangan', 'aktif', 'dalam_maintenance', 'menunggu_data', 'rusak', 'nonaktif']),
  // <input type="date"> browser -> 'YYYY-MM-DD', dikirim apa adanya (backend
  // terima IsDateString). Field teks kosong = gak diubah (lihat
  // trimmedOrUndefined di mutationFn) — form ini BELUM bisa ngosongin
  // tanggal yang udah keisi, cuma ganti ke tanggal lain atau dibiarin.
  installationDate: z.string().optional(),
  lastServiceDate: z.string().optional(),
  nextServiceDate: z.string().optional(),
  // Pengingat servis per unit AC (2026-09-30): 1 unit = 1 set indoor+outdoor.
  reminderEnabled: z.boolean(),
  serviceIntervalDays: z.string().optional(),
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
      reminderEnabled: true,
      serviceIntervalDays: '',
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
      status: (STATUS_OPTIONS.some((o) => o.value === unit.status)
        ? unit.status
        : 'aktif') as z.infer<typeof editSchema>['status'],
      installationDate: toDateInputValue(unit.installationDate),
      lastServiceDate: toDateInputValue(unit.lastServiceDate),
      nextServiceDate: toDateInputValue(unit.nextServiceDate),
      reminderEnabled: unit.reminderEnabled !== false,
      serviceIntervalDays: unit.serviceIntervalDays != null ? String(unit.serviceIntervalDays) : '',
    });
    setEditOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: (values: EditFormValues) => {
      const unit = data!.unit;
      const wasEnabled = unit.reminderEnabled !== false;
      const prevDays = unit.serviceIntervalDays != null ? String(unit.serviceIntervalDays) : '';
      const daysChanged = (values.serviceIntervalDays ?? '').trim() !== prevDays;
      const toggled = values.reminderEnabled !== wasEnabled;
      // Tanggal manual hanya dikirim kalau admin mengubahnya DAN pengingat/
      // siklus tidak ikut berubah (kalau ikut berubah, backend menghitung
      // ulang jadwalnya sendiri).
      const nextChanged = (values.nextServiceDate ?? '') !== toDateInputValue(unit.nextServiceDate);
      const sendNext = nextChanged && !toggled && !daysChanged && values.reminderEnabled;
      return apiClient.patch(`/ac-units/${unitId}`, {
        reminderEnabled: toggled ? values.reminderEnabled : undefined,
        serviceIntervalDays:
          values.reminderEnabled && (values.serviceIntervalDays ?? '').trim() && daysChanged
            ? Number(values.serviceIntervalDays)
            : undefined,
        brand: trimmedOrUndefined(values.brand),
        model: trimmedOrUndefined(values.model),
        pk: values.pk?.trim() ? Number(values.pk) : undefined,
        roomLocation: trimmedOrUndefined(values.roomLocation),
        serialNumber: trimmedOrUndefined(values.serialNumber),
        status: values.status,
        installationDate: trimmedOrUndefined(values.installationDate),
        lastServiceDate: trimmedOrUndefined(values.lastServiceDate),
        nextServiceDate: sendNext ? trimmedOrUndefined(values.nextServiceDate) : undefined,
      });
    },
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
              Betulin data unit AC - barcode & pemilik gak bisa diubah dari sini.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              className="grid gap-4"
              onSubmit={form.handleSubmit((values) => {
                // Siklus wajib kalau pengingat DINYALAKAN (dari mati) atau
                // diisi; unit lama yang masih kosong boleh tetap kosong.
                const wasEnabled = data.unit.reminderEnabled !== false;
                const d = (values.serviceIntervalDays ?? '').trim();
                if (values.reminderEnabled && (d || !wasEnabled)) {
                  const e = intervalError(d);
                  if (e) {
                    form.setError('serviceIntervalDays', { message: e });
                    return;
                  }
                }
                saveMutation.mutate(values);
              })}
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
              <ReminderScheduleFields
                title="Pengingat servis WA (1 set AC)"
                enabled={form.watch('reminderEnabled')}
                onEnabledChange={(v) => form.setValue('reminderEnabled', v, { shouldDirty: true })}
                days={form.watch('serviceIntervalDays') ?? ''}
                onDaysChange={(v) => {
                  form.clearErrors('serviceIntervalDays');
                  form.setValue('serviceIntervalDays', v, { shouldDirty: true });
                }}
                baseDate={
                  form.watch('lastServiceDate') ? new Date(form.watch('lastServiceDate') as string) : undefined
                }
              />
              {form.formState.errors.serviceIntervalDays && (
                <p className="-mt-2 text-xs text-destructive">
                  {form.formState.errors.serviceIntervalDays.message}
                </p>
              )}
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
