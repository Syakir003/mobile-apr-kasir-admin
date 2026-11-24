'use client';

import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { MAPS_INPUT_PLACEHOLDER, mapsInputDisplay } from '@/lib/maps-input';
import { checkAddress, fixAddress, isMapsLink } from '@/lib/address-check';
import { AddressHint } from '@/components/address-hint';
import { PHONE_ERROR_MESSAGE, isValidIndonesianPhone } from '@/lib/phone';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { MultiLocationFields } from '@/components/multi-location-fields';
import {
  LocationDraftsEditor,
  applyLocationDrafts,
  draftsFromLocations,
  validateLocationDrafts,
  type MemberLocationRow,
} from './member-locations';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface EditableMember {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  mapsUrl?: string | null;
  customerType: string | null;
  notes: string | null;
  active: boolean;
  multiLocation?: boolean;
  mainLocationName?: string | null;
  // Lokasi tambahan member multi lokasi (Lokasi 1 = alamat utama): bisa ditambah/diubah/dihapus langsung di dialog ini.
  locations?: MemberLocationRow[];
}

// Sama dengan form Tambah Member: nama wajib. Link Maps boleh link atau ketikan biasa (backend menormalkannya jadi link);
// dikosongkan = hapus link.
const editMemberSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi'),
  phone: z.string().optional(),
  address: z.string().optional(),
  mapsUrl: z.string().optional(),
  customerType: z.enum(['rumah', 'perusahaan', 'toko', '']).optional(),
  notes: z.string().optional(),
  active: z.boolean(),
  // Multi lokasi: dimatikan ditolak backend selama masih ada unit di lokasi selain Lokasi 1.
  multiLocation: z.boolean(),
  mainLocationName: z.string().optional(),
});
type EditMemberValues = z.infer<typeof editMemberSchema>;

/**
 * Ubah data member (PATCH /members/:id, admin & kasir): nama, nomor HP, alamat, link Maps, tipe customer, catatan, dan
 * status aktif. Tipe pembeli (harga) tetap diatur terpisah di kartu Data Member, khusus admin. Form dibuat ulang setiap
 * dialog dibuka (DialogContent tidak dirender saat tertutup), jadi selalu berisi data terbaru.
 */
export function EditMemberDialog({
  open,
  onOpenChange,
  member,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: EditableMember;
  /** Dipanggil sesudah tersimpan (data sudah dimuat ulang) dengan id lokasi yang baru dibuat, untuk menawarkan pindah unit. */
  onSaved?: (createdLocationIds: string[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ubah Data Member</DialogTitle>
          <DialogDescription>
            Perubahan berlaku untuk transaksi dan servis berikutnya. Alamat dan link ini adalah alamat utama pelanggan;
            lokasi kerja yang berbeda diisi di form Terima Servis.
          </DialogDescription>
        </DialogHeader>
        <EditMemberForm
          member={member}
          onDone={(createdIds) => {
            onOpenChange(false);
            onSaved?.(createdIds);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditMemberForm({
  member,
  onDone,
}: {
  member: EditableMember;
  onDone: (createdLocationIds: string[]) => void;
}) {
  const queryClient = useQueryClient();
  // Lokasi tambahan yang sedang diedit (belum tersimpan sampai Simpan).
  const [locationDrafts, setLocationDrafts] = React.useState(() => draftsFromLocations(member.locations ?? []));
  const originalPhone = (member.phone ?? '').trim();
  const originalAddress = (member.address ?? '').trim();
  const schema = editMemberSchema.superRefine((v, ctx) => {
    const p = (v.phone ?? '').trim();
    if (p !== originalPhone && !isValidIndonesianPhone(p)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: PHONE_ERROR_MESSAGE });
    }
    // Alamat hanya diperiksa bila diubah (member lama dengan alamat tak lengkap tetap bisa diedit bagian lainnya).
    const a = (v.address ?? '').trim();
    if (a !== originalAddress) {
      const c = checkAddress(a, { hasMapsLink: isMapsLink(v.mapsUrl) });
      if (c.blocking) ctx.addIssue({ code: 'custom', path: ['address'], message: c.blocking });
    }
  });
  const form = useForm<EditMemberValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: member.name,
      phone: member.phone ?? '',
      address: member.address ?? '',
      mapsUrl: mapsInputDisplay(member.mapsUrl),
      customerType: (member.customerType as EditMemberValues['customerType']) ?? '',
      notes: member.notes ?? '',
      active: member.active,
      multiLocation: member.multiLocation ?? false,
      mainLocationName: member.mainLocationName ?? '',
    },
  });

  const mapsUrlValue = useWatch({ control: form.control, name: 'mapsUrl' });
  const multiLocationValue = useWatch({ control: form.control, name: 'multiLocation' });
  const mainLocationNameValue = useWatch({ control: form.control, name: 'mainLocationName' });

  const saveMutation = useMutation({
    mutationFn: async (v: EditMemberValues) => {
      await apiClient.patch(`/members/${member.id}`, {
        name: v.name.trim(),
        // Nomor dikirim hanya bila diubah (kosong = hapus nomor).
        ...((v.phone ?? '').trim() !== originalPhone ? { phone: (v.phone ?? '').trim() } : {}),
        // "Kab." -> "Kabupaten" hanya bila alamat diubah (alamat lama tidak diutak-atik).
        address: (v.address ?? '').trim() === originalAddress ? originalAddress : fixAddress(v.address ?? ''),
        // Kosong = hapus link (backend menyimpan null).
        mapsUrl: (v.mapsUrl ?? '').trim(),
        ...(v.customerType ? { customerType: v.customerType } : {}),
        notes: (v.notes ?? '').trim(),
        active: v.active,
        multiLocation: v.multiLocation,
        // Nama Lokasi 1 dikirim hanya bila multi lokasi menyala (kosong = kembali ke "Lokasi 1").
        ...(v.multiLocation ? { mainLocationName: (v.mainLocationName ?? '').trim() } : {}),
      });
      // Lokasi tambahan diterapkan SESUDAH data member tersimpan (saklar multi lokasi harus sudah menyala di server).
      return v.multiLocation
        ? applyLocationDrafts(member.id, member.locations ?? [], locationDrafts)
        : { errors: [] as string[], createdIds: [] as string[] };
    },
    onSuccess: async (res) => {
      // Seluruh awalan 'members' (detail + daftar) dan pencarian member di form lain; ditunggu supaya data baru sudah
      // dimuat saat dialog tawaran pindah unit dibuka.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['members'] }),
        queryClient.invalidateQueries({ queryKey: ['members-pick'] }),
      ]);
      if (res.errors.length > 0) {
        toast.error(
          `Data member tersimpan, tetapi ada lokasi yang gagal: ${res.errors.join('; ')}. Buka Ubah Member lagi untuk melengkapinya.`,
        );
      } else {
        toast.success('Data member diperbarui.');
      }
      onDone(res.createdIds);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan data member.');
    },
  });

  return (
    <Form {...form}>
      <form
        className="grid gap-4"
        onSubmit={form.handleSubmit((v) => {
          // Lokasi tambahan diperiksa dulu (nama, alamat/link, tidak kembar) supaya tidak setengah tersimpan.
          const problem = v.multiLocation
            ? validateLocationDrafts(locationDrafts, (v.mainLocationName ?? '').trim() || null)
            : null;
          if (problem) {
            toast.error(problem);
            return;
          }
          saveMutation.mutate(v);
        })}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nama</FormLabel>
              <FormControl>
                <Input placeholder="Nama pelanggan" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>No. HP</FormLabel>
              <FormControl>
                <Input placeholder="Mis. 0855xxxxxxxx atau 62855xxxxxxxx" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Alamat Utama</FormLabel>
              <FormControl>
                <Textarea rows={2} placeholder="Opsional" {...field} />
              </FormControl>
              {/* Petunjuk hanya muncul bila alamat diubah dari yang tersimpan. */}
              {(field.value ?? '').trim() !== originalAddress && (
                <AddressHint
                  value={field.value}
                  hasMapsLink={isMapsLink(mapsUrlValue)}
                  hideBlocking={!!form.formState.errors.address}
                />
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="mapsUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Link Lokasi Utama (Google Maps)</FormLabel>
              <FormControl>
                <Input placeholder={MAPS_INPUT_PLACEHOLDER} {...field} />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Tombol Buka di Maps akan membuka link ini, atau mencari nama daerah/tempat yang diketik. Kosongkan untuk menghapus.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="customerType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipe Customer</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Belum diisi" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="rumah">Rumah</SelectItem>
                  <SelectItem value="perusahaan">Perusahaan</SelectItem>
                  <SelectItem value="toko">Toko</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Catatan</FormLabel>
              <FormControl>
                <Textarea rows={2} placeholder="Opsional" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="active"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-2">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
              </FormControl>
              <FormLabel className="font-normal">Member aktif</FormLabel>
            </FormItem>
          )}
        />
        <MultiLocationFields
          idPrefix="edit-member"
          enabled={multiLocationValue}
          onEnabledChange={(v) => form.setValue('multiLocation', v, { shouldDirty: true })}
          mainName={mainLocationNameValue ?? ''}
          onMainNameChange={(v) => form.setValue('mainLocationName', v, { shouldDirty: true })}
        />
        {multiLocationValue && <LocationDraftsEditor drafts={locationDrafts} onChange={setLocationDrafts} />}
        <DialogFooter>
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
