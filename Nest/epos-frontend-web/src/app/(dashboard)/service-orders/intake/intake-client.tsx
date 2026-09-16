'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Search, Wrench } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { optionalNumberField, numberOrUndefined, trimmedOrUndefined } from '@/lib/form-number';
import type { Role } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

// Siklus 2 — Servis Masuk Mandiri: customer yang DULU beli AC doang (checkout
// tanpa centang "Pasang unit" -> gak ada MemberAcUnit/barcode yang lahir)
// balik lagi minta servis/instalasi belakangan. Halaman ini yang jadi titik
// masuknya: pilih member -> pilih unit yang udah terdaftar ATAU daftarin unit
// yang belum pernah tercatat (baru di situ barcode/QR label-nya digenerate) ->
// isi keluhan -> POST /service-orders/intake. Endpoint ini udah lama ada &
// sudah dipakai instalasi dari POS (createForOrder yang sama), cuma belum
// pernah punya halaman di web — lihat plan/2026-08-20-siklus-servis-masuk-mandiri.md.

interface MemberSearchResult {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}
interface AcUnitRow {
  id: string;
  brand: string | null;
  model: string | null;
  roomLocation: string | null;
  barcodeValue: string;
  status: string;
}
interface MemberDetail {
  id: string;
  acUnits: AcUnitRow[];
}
interface UserRow {
  id: string;
  displayName: string;
  role: Role;
  active: boolean;
}
interface IntakeResult {
  serviceOrderId: string;
  memberId: string;
  unitId: string;
  barcodeValue: string;
  jobId: string;
  jobStatus: string;
}

const intakeSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  phone: z.string().min(1, 'Wajib diisi'),
  address: z.string().optional(),
  complaint: z.string().min(1, 'Keluhan wajib diisi'),
  newBrand: z.string().optional(),
  newModel: z.string().optional(),
  newPk: optionalNumberField,
  newRoomLocation: z.string().optional(),
  newSerialNumber: z.string().optional(),
  scheduledDate: z.string().optional(),
});
type IntakeFormValues = z.infer<typeof intakeSchema>;

export function ServiceIntakeClient({ role }: { role: Role }) {
  const router = useRouter();
  const isAdmin = role === 'admin';

  const [selectedMember, setSelectedMember] = React.useState<MemberSearchResult | null>(null);
  const [memberSearch, setMemberSearch] = React.useState('');
  const [memberSearchDebounced, setMemberSearchDebounced] = React.useState('');
  const [unitMode, setUnitMode] = React.useState<'existing' | 'new'>('new');
  const [existingUnitId, setExistingUnitId] = React.useState<string | undefined>(undefined);
  const [technicianId, setTechnicianId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const t = setTimeout(() => setMemberSearchDebounced(memberSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [memberSearch]);

  const memberSearchQuery = useQuery({
    queryKey: ['members-search', memberSearchDebounced],
    queryFn: () =>
      apiClient.get<MemberSearchResult[]>(
        `/members/search?q=${encodeURIComponent(memberSearchDebounced)}`,
      ),
    enabled: memberSearchDebounced.length > 0,
  });

  // Unit-unit yang udah kepunya member terpilih — cuma relevan kalau member
  // udah dipilih dari daftar (member baru pasti belum punya unit apapun).
  const memberDetailQuery = useQuery({
    queryKey: ['members', selectedMember?.id],
    queryFn: () => apiClient.get<MemberDetail>(`/members/${selectedMember!.id}`),
    enabled: !!selectedMember,
  });
  const memberUnits = memberDetailQuery.data?.acUnits ?? [];

  // GET /users admin-only di backend (sama kayak teknisi/queue/queue-client.tsx)
  // -> kasir gak dapet dropdown teknisi, job-nya lahir 'menunggu_penugasan'
  // dan admin yang nugasin belakangan lewat halaman Job Teknisi.
  const techniciansQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<UserRow[]>('/users'),
    enabled: isAdmin,
  });
  const technicians = (techniciansQuery.data ?? []).filter(
    (u) => u.role === 'teknisi' && u.active,
  );

  function selectMember(m: MemberSearchResult) {
    setSelectedMember(m);
    setMemberSearch('');
    form.setValue('name', m.name, { shouldValidate: true });
    form.setValue('phone', m.phone ?? '', { shouldValidate: true });
    form.setValue('address', m.address ?? '');
    setExistingUnitId(undefined);
    setUnitMode('new');
  }

  function clearSelectedMember() {
    setSelectedMember(null);
    setMemberSearch('');
    setExistingUnitId(undefined);
    setUnitMode('new');
    form.setValue('name', '');
    form.setValue('phone', '');
    form.setValue('address', '');
  }

  const form = useForm<IntakeFormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      name: '',
      phone: '',
      address: '',
      complaint: '',
      newBrand: '',
      newModel: '',
      newPk: '',
      newRoomLocation: '',
      newSerialNumber: '',
      scheduledDate: '',
    },
  });

  const intakeMutation = useMutation({
    mutationFn: async (values: IntakeFormValues) => {
      const body: Record<string, unknown> = {
        customer: {
          name: values.name.trim(),
          phone: values.phone.trim(),
          address: trimmedOrUndefined(values.address),
          memberId: selectedMember?.id,
        },
        complaint: values.complaint.trim(),
        technicianId,
        scheduledDate: trimmedOrUndefined(values.scheduledDate),
      };
      if (unitMode === 'existing') {
        body.existingUnitId = existingUnitId;
      } else {
        body.newUnit = {
          brand: trimmedOrUndefined(values.newBrand),
          model: trimmedOrUndefined(values.newModel),
          pk: numberOrUndefined(values.newPk),
          roomLocation: trimmedOrUndefined(values.newRoomLocation),
          serialNumber: trimmedOrUndefined(values.newSerialNumber),
        };
      }
      return apiClient.post<IntakeResult>('/service-orders/intake', body);
    },
    onSuccess: (result) => {
      toast.success('Job servis dibuat.');
      // Langsung ke halaman cetak label QR unit-nya — inti fitur ini
      // (unit yang belum pernah tercatat baru dapet barcode di titik ini).
      router.push(`/service-orders/${result.serviceOrderId}/print-labels`);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal membuat job servis.');
    },
  });

  function onSubmit(values: IntakeFormValues) {
    if (unitMode === 'existing' && !existingUnitId) {
      toast.error('Pilih salah satu unit AC member ini.');
      return;
    }
    intakeMutation.mutate(values);
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Servis Mandiri</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buat job servis buat customer yang bawa/minta servis unit AC-nya sendiri — baik unit
          yang udah kebeli/terdaftar di toko ini, maupun unit lama yang belum pernah tercatat.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data Pelanggan</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <FormLabel>Member</FormLabel>
                {selectedMember ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{selectedMember.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {selectedMember.phone || 'Tanpa nomor HP'}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={clearSelectedMember}>
                      Ganti
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Cari nama/HP member lama, atau kosongkan buat pelanggan baru"
                      className="pl-9"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                    />
                    {memberSearch.trim() && (
                      <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
                        {memberSearchQuery.isLoading && (
                          <p className="p-2 text-xs text-muted-foreground">Mencari...</p>
                        )}
                        {memberSearchQuery.data?.length === 0 && (
                          <p className="p-2 text-xs text-muted-foreground">
                            Gak ketemu — isi manual di bawah buat pelanggan baru.
                          </p>
                        )}
                        {memberSearchQuery.data?.map((m) => (
                          <button
                            type="button"
                            key={m.id}
                            onClick={() => selectMember(m)}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <p className="font-medium">{m.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {m.phone || 'Tanpa nomor HP'}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama Pelanggan</FormLabel>
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
                    <FormLabel>Nomor HP</FormLabel>
                    <FormControl>
                      <Input placeholder="08xxxxxxxxxx" {...field} />
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
                    <FormLabel>Alamat</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Opsional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Unit AC</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={unitMode} onValueChange={(v) => setUnitMode(v as 'existing' | 'new')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger
                    value="existing"
                    disabled={memberUnits.length === 0}
                    // Default shadcn cuma disabled:opacity-50 — kurang
                    // kontras buat nunjukin "belum bisa diisi" (gampang
                    // kekira aktif tapi léngang). Ditebelin lagi opacity +
                    // teksnya digelapin dikit biar jelas beda dari tab aktif.
                    className="disabled:opacity-40 disabled:text-muted-foreground"
                    title={
                      !selectedMember
                        ? 'Pilih member dulu buat mengaktifkan tab ini'
                        : memberUnits.length === 0
                          ? 'Member ini belum punya unit AC terdaftar'
                          : undefined
                    }
                  >
                    Unit Sudah Terdaftar
                  </TabsTrigger>
                  <TabsTrigger value="new">Unit Belum Tercatat</TabsTrigger>
                </TabsList>
                {/* Tab di atas cuma nyala kalau member udah dipilih & punya
                    unit — teks ini bikin ALASANNYA keliatan tanpa perlu
                    hover, soalnya tab yang disabled gak bisa diklik buat
                    ngebuka TabsContent-nya sendiri yang isinya penjelasan
                    serupa. */}
                {memberUnits.length === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {selectedMember
                      ? 'Member ini belum punya unit AC terdaftar — pakai tab "Unit Belum Tercatat".'
                      : 'Pilih member di atas dulu buat mengaktifkan tab ini.'}
                  </p>
                )}

                <TabsContent value="existing" className="mt-4">
                  {!selectedMember && (
                    <p className="text-sm text-muted-foreground">
                      Pilih member dulu di atas buat lihat unit AC yang udah dia punya.
                    </p>
                  )}
                  {selectedMember && memberDetailQuery.isLoading && (
                    <p className="text-sm text-muted-foreground">Memuat unit AC member...</p>
                  )}
                  {selectedMember && !memberDetailQuery.isLoading && memberUnits.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Member ini belum punya unit AC terdaftar — pakai tab &quot;Unit Belum
                      Tercatat&quot;.
                    </p>
                  )}
                  {memberUnits.length > 0 && (
                    <Select value={existingUnitId} onValueChange={setExistingUnitId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pilih unit AC" />
                      </SelectTrigger>
                      <SelectContent>
                        {memberUnits.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {[u.brand, u.model].filter(Boolean).join(' ') || 'Unit AC'}
                            {u.roomLocation ? ` — ${u.roomLocation}` : ''} ({u.barcodeValue})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TabsContent>

                <TabsContent value="new" className="mt-4 grid gap-4">
                  <p className="text-xs text-muted-foreground">
                    Unit AC yang belum pernah tercatat di sistem (dibeli di tempat lain, atau
                    dibeli di toko ini sebelum ada sistem ini). Semua boleh dikosongin kalau belum
                    tahu persis — bisa dilengkapi teknisi belakangan. Barcode/QR unit baru
                    digenerate begitu job ini dibuat.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="newBrand"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Merek</FormLabel>
                          <FormControl>
                            <Input placeholder="Opsional" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="newModel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Model</FormLabel>
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
                      name="newPk"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>PK</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="Opsional" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="newSerialNumber"
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
                    name="newRoomLocation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lokasi Ruangan</FormLabel>
                        <FormControl>
                          <Input placeholder="Opsional, mis. Kamar Utama" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Keluhan &amp; Penjadwalan</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField
                control={form.control}
                name="complaint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Keluhan</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="Mis. AC gak dingin, bunyi berisik, dsb."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isAdmin && (
                <div className="grid gap-1.5">
                  <FormLabel>Teknisi (opsional)</FormLabel>
                  <Select value={technicianId} onValueChange={setTechnicianId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Belum ditentukan" />
                    </SelectTrigger>
                    <SelectContent>
                      {technicians.length === 0 && (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                          Belum ada teknisi aktif
                        </p>
                      )}
                      {technicians.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <FormField
                control={form.control}
                name="scheduledDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Jadwal (opsional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Button type="submit" disabled={intakeMutation.isPending}>
            <Wrench className="size-4" />
            {intakeMutation.isPending ? 'Menyimpan...' : 'Buat Job Servis'}
          </Button>
        </form>
      </Form>
    </div>
  );
}
