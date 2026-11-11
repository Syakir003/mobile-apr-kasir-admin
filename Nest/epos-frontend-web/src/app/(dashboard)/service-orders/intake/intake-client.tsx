'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Copy, Plus, QrCode, Trash2, Wrench } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { numberOrUndefined, trimmedOrUndefined } from '@/lib/form-number';
import { MAPS_INPUT_PLACEHOLDER, mapsInputDisplay } from '@/lib/maps-input';
import { phoneError } from '@/lib/phone';
import { wibDateKey } from '@/lib/wib-date';
import { statusLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { MemberPicker } from '@/components/member-picker';
import { TechnicianMultiPicker } from '@/components/technician-multi-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
// masuknya: pilih member -> pilih unit yang udah terdaftar (boleh lebih dari
// satu) dan/atau daftarin unit yang belum pernah tercatat (baru di situ
// barcode/QR label-nya digenerate) -> isi keluhan -> POST /service-orders/intake.
// Satu order = satu nota; tiap unit jadi job sendiri (temuan, foto, scan, riwayat
// per unit). Endpoint ini udah lama ada & sudah dipakai instalasi dari POS
// (createForOrder yang sama) — lihat plan/2026-08-20-siklus-servis-masuk-mandiri.md.

interface MemberSearchResult {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  mapsUrl?: string | null;
}
interface AcUnitRow {
  id: string;
  brand: string | null;
  model: string | null;
  roomLocation: string | null;
  barcodeValue: string;
  status: string;
  // Job yang belum selesai/dibatalkan pada unit ini (maks. 1): unit seperti ini tidak bisa dibuatkan job servis baru.
  technicianJobs?: { id: string; status: string }[];
  // Siklus servis unit (GET /members/:id mengirim semua kolom unit): dasar "jatuh tempo" pada isian otomatis.
  nextServiceDate?: string | null;
  reminderEnabled?: boolean;
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
  // Field tingkat atas = unit/job PERTAMA (bentuk lama); `jobs` memuat semua unit order ini.
  unitId: string;
  barcodeValue: string;
  unitLabeled: boolean;
  jobId: string;
  jobStatus: string;
  jobs: { jobId: string; unitId: string; barcodeValue: string; unitLabeled: boolean; jobStatus: string }[];
  // Unit yang labelnya masih perlu dicetak; kosong = semua sudah terlabel (tidak perlu halaman cetak).
  unitsToLabel: string[];
}

// Satu baris "unit baru (belum tercatat)". qrDulu = tipe AC belum diketahui: cuma QR yang dibuat, teknisi yang
// mengisi merk/PK saat scan di lokasi (sama dengan Input Data Lampau mode "QR dulu").
interface NewUnitRow {
  key: number;
  qrDulu: boolean;
  brand: string;
  model: string;
  pk: string;
  serialNumber: string;
  roomLocation: string;
  // Titik lokasi kerja unit ini (key dari daftar titik). Titik yang sudah dihapus -> jatuh ke titik pertama.
  locKey: number;
}
const blankRow = (key: number, qrDulu = false): NewUnitRow => ({
  key,
  qrDulu,
  brand: '',
  model: '',
  pk: '',
  serialNumber: '',
  roomLocation: '',
  locKey: DEFAULT_LOC_KEY,
});
// Baris bawaan (satu unit baru kosong) memakai key tetap; baris tambahan dapat key dari counter.
const DEFAULT_ROW_KEY = 0;

// Titik lokasi kerja: tempat AC dikerjakan bila BERBEDA dari alamat utama pelanggan. Titik tanpa isi = ikut alamat
// pelanggan. Satu pelanggan bisa punya AC di beberapa tempat, jadi titiknya boleh lebih dari satu dan tiap unit memilih.
interface WorkLocationRow {
  key: number;
  address: string;
  mapsUrl: string;
}
const DEFAULT_LOC_KEY = 0;
const MAX_LOCATIONS = 10;
// Daftar unit terdaftar milik member: maks. baris ke bawah sebelum mengalir ke kolom berikutnya (digeser ke samping).
const MAX_UNIT_ROWS = 10;
const blankLocation = (key: number): WorkLocationRow => ({ key, address: '', mapsUrl: '' });
function locationLabel(l: WorkLocationRow, i: number): string {
  const t = l.address.trim() || (l.mapsUrl.trim() ? 'link Maps' : '');
  return `Titik ${i + 1} - ${t ? (t.length > 40 ? `${t.slice(0, 40)}...` : t) : 'ikut alamat pelanggan'}`;
}

const intakeSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  phone: z.string().min(1, 'Wajib diisi'),
  address: z.string().optional(),
  mapsUrl: z.string().optional(),
  jobType: z.enum(['perbaikan', 'cuci', 'maintenance', 'bongkar', 'pasang', 'bongkar_pasang']),
  workDescription: z.string().optional(),
  complaint: z.string().trim().min(1, 'Keluhan awal wajib diisi (kalau tidak ada, isi pekerjaannya, mis. Cuci AC)'),
  scheduledDate: z.string().min(1, 'Jadwal wajib diisi'),
});
type IntakeFormValues = z.infer<typeof intakeSchema>;

// Isian otomatis: pelanggan terpilih, unit tercentang, jenis Cuci AC. Jadwal sengaja kosong.
// - dueOnly (notifikasi "servis jatuh tempo"): semua unit jatuh tempo (siklus <= 3 hari lagi, termasuk yang sudah lewat).
// - unitIds (tombol Buat Job Servis di halaman jadwal pelanggan): unit yang dipilih admin di sana.
export interface IntakePrefill {
  memberId: string;
  dueOnly: boolean;
  unitIds?: string[];
}

export function ServiceIntakeClient({ role, prefill }: { role: Role; prefill?: IntakePrefill }) {
  const router = useRouter();
  const isAdmin = role === 'admin';

  const [selectedMember, setSelectedMember] = React.useState<MemberSearchResult | null>(null);
  // Unit terdaftar yang dicentang (boleh banyak) + baris unit baru. rowsState null = belum disentuh: bawaannya satu
  // baris kosong untuk pelanggan tanpa unit terdaftar, dan kosong kalau member terpilih sudah punya unit (supaya
  // tidak ada unit kosong yang ikut terdaftar tanpa sengaja).
  const [existingUnitIds, setExistingUnitIds] = React.useState<string[]>([]);
  const [rowsState, setRowsState] = React.useState<NewUnitRow[] | null>(null);
  const nextRowKey = React.useRef(1);
  const [technicianIds, setTechnicianIds] = React.useState<string[]>([]);
  // Titik lokasi kerja (bawaan satu titik kosong = ikut alamat pelanggan) + pilihan titik tiap unit terdaftar yang dicentang.
  const [locations, setLocations] = React.useState<WorkLocationRow[]>([blankLocation(DEFAULT_LOC_KEY)]);
  const [existingLoc, setExistingLoc] = React.useState<Record<string, number>>({});
  const nextLocKey = React.useRef(1);

  // Unit-unit yang udah kepunya member terpilih — cuma relevan kalau member
  // udah dipilih dari daftar (member baru pasti belum punya unit apapun).
  const memberDetailQuery = useQuery({
    queryKey: ['members', selectedMember?.id],
    queryFn: () => apiClient.get<MemberDetail>(`/members/${selectedMember!.id}`),
    enabled: !!selectedMember,
  });
  const memberUnits = memberDetailQuery.data?.acUnits ?? [];
  // Member dengan banyak unit (mis. rumah sakit): daftar mengalir ke samping per kolom, maks. MAX_UNIT_ROWS baris ke
  // bawah, dan digeser kanan-kiri. Sampai MAX_UNIT_ROWS unit tampilannya tetap satu daftar ke bawah seperti biasa.
  const unitColumns = Math.ceil(memberUnits.length / MAX_UNIT_ROWS);
  const unitRows = Math.min(MAX_UNIT_ROWS, memberUnits.length);
  // Unit yang masih punya job aktif tidak bisa dipilih (backend menolak job ganda), jadi tidak ikut "Pilih semua".
  const selectableUnitIds = memberUnits.filter((u) => (u.technicianJobs?.length ?? 0) === 0).map((u) => u.id);
  const busyUnitCount = memberUnits.length - selectableUnitIds.length;
  const allExistingSelected =
    selectableUnitIds.length > 0 && selectableUnitIds.every((id) => existingUnitIds.includes(id));
  const defaultRows = memberUnits.length > 0 ? [] : [blankRow(DEFAULT_ROW_KEY)];
  const newUnits = rowsState ?? defaultRows;
  const totalUnits = existingUnitIds.length + newUnits.length;

  // Pembaruan fungsional (bukan dari nilai render terakhir) supaya klik beruntun tidak saling menimpa.
  function editRows(fn: (rows: NewUnitRow[]) => NewUnitRow[]) {
    setRowsState((prev) => fn(prev ?? defaultRows));
  }
  function addRow(qrDulu: boolean) {
    const key = nextRowKey.current++;
    editRows((rows) => [...rows, blankRow(key, qrDulu)]);
  }
  function patchRow(key: number, patch: Partial<NewUnitRow>) {
    editRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: number) {
    editRows((rows) => rows.filter((r) => r.key !== key));
  }
  function toggleExisting(id: string, checked: boolean) {
    setExistingUnitIds((cur) => (checked ? [...cur, id] : cur.filter((x) => x !== id)));
  }
  function selectAllExisting() {
    setExistingUnitIds((cur) => [...new Set([...cur, ...selectableUnitIds])]);
  }
  function clearExisting() {
    setExistingUnitIds([]);
  }

  // Titik lokasi kerja. Pembaruan fungsional supaya klik beruntun tidak saling menimpa.
  const resolveLocKey = (key: number | undefined) =>
    locations.some((l) => l.key === key) ? (key as number) : locations[0].key;
  function addLocation() {
    const key = nextLocKey.current++;
    setLocations((cur) => (cur.length >= MAX_LOCATIONS ? cur : [...cur, blankLocation(key)]));
  }
  function patchLocation(key: number, patch: Partial<WorkLocationRow>) {
    setLocations((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLocation(key: number) {
    setLocations((cur) => (cur.length <= 1 ? cur : cur.filter((l) => l.key !== key)));
  }
  // Tombol "Samakan dengan alamat pelanggan": salin alamat utama + link maps dari kartu Data Pelanggan ke titik ini.
  function copyMemberAddress(key: number) {
    const address = (form.getValues('address') ?? '').trim();
    const mapsUrl = (form.getValues('mapsUrl') ?? '').trim();
    if (!address && !mapsUrl) {
      toast.error('Alamat pelanggan masih kosong. Isi dulu di Data Pelanggan.');
      return;
    }
    patchLocation(key, { address, mapsUrl });
  }

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
    form.setValue('name', m.name, { shouldValidate: true });
    form.setValue('phone', m.phone ?? '', { shouldValidate: true });
    form.setValue('address', m.address ?? '');
    form.setValue('mapsUrl', mapsInputDisplay(m.mapsUrl));
    setExistingUnitIds([]);
    setExistingLoc({});
    setRowsState(null);
  }

  function clearSelectedMember() {
    setSelectedMember(null);
    setExistingUnitIds([]);
    setRowsState(null);
    form.setValue('name', '');
    form.setValue('phone', '');
    form.setValue('address', '');
    form.setValue('mapsUrl', '');
  }

  const form = useForm<IntakeFormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      name: '',
      phone: '',
      address: '',
      mapsUrl: '',
      jobType: 'perbaikan',
      workDescription: '',
      complaint: '',
      scheduledDate: '',
    },
  });

  // Isian otomatis. Dijalankan sekali per pelanggan; hasilnya diterapkan dari callback async (bukan langsung di effect).
  const [prefillNote, setPrefillNote] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!prefill) return;
    let cancelled = false;
    apiClient
      .get<MemberSearchResult & { acUnits?: AcUnitRow[] }>(`/members/${prefill.memberId}`)
      .then((m) => {
        if (cancelled) return;
        selectMember(m);
        const wanted = prefill.unitIds;
        if (!prefill.dueOnly && !wanted) return; // hanya memilih pelanggan
        const limit = wibDateKey(new Date(Date.now() + 3 * 86400000));
        // Unit dengan job aktif tidak bisa dibuatkan job baru, jadi tidak ikut tercentang.
        const dueIds = (m.acUnits ?? [])
          .filter((u) =>
            wanted
              ? wanted.includes(u.id) && (u.technicianJobs?.length ?? 0) === 0
              : (u.technicianJobs?.length ?? 0) === 0 &&
                u.status === 'aktif' &&
                u.reminderEnabled !== false &&
                !!u.nextServiceDate &&
                wibDateKey(u.nextServiceDate) <= limit,
          )
          .map((u) => u.id);
        setExistingUnitIds(dueIds);
        form.setValue('jobType', 'cuci');
        form.setValue('complaint', 'Cuci AC rutin (siklus servis)', { shouldValidate: true });
        let note: string;
        if (wanted) {
          const skipped = wanted.length - dueIds.length;
          note =
            dueIds.length > 0
              ? `Terisi otomatis dari jadwal servis ${m.name}: ${dueIds.length} unit AC pilihan sudah tercentang dan jenisnya Cuci AC${skipped > 0 ? ` (${skipped} unit dilewati karena sudah punya job aktif)` : ''}. Tentukan jadwal lalu buat job.`
              : `Data ${m.name} terisi otomatis, tetapi unit yang dipilih sudah punya job aktif. Pilih unit yang diservis, tentukan jadwal, lalu buat job.`;
        } else {
          note =
            dueIds.length > 0
              ? `Terisi otomatis dari siklus servis ${m.name}: ${dueIds.length} unit AC jatuh tempo sudah tercentang dan jenisnya Cuci AC. Tentukan jadwal lalu buat job.`
              : `Data ${m.name} terisi otomatis, tetapi tidak ada unit yang jatuh tempo atau bebas dari job aktif. Pilih unit yang diservis, tentukan jadwal, lalu buat job.`;
        }
        setPrefillNote(note);
      })
      .catch(() => {
        if (!cancelled) toast.error('Gagal memuat data pelanggan untuk diisi otomatis. Pilih pelanggan secara manual.');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali per pelanggan; fungsi/state di dalamnya stabil.
  }, [prefill?.memberId, prefill?.dueOnly, prefill?.unitIds?.join(',')]);

  const intakeMutation = useMutation({
    mutationFn: async (values: IntakeFormValues) => {
      // Titik lokasi dikirim kalau ada isinya atau titiknya lebih dari satu (satu titik kosong = ikut alamat pelanggan).
      const sendLocations = locations.length > 1 || locations.some((l) => l.address.trim() || l.mapsUrl.trim());
      const locIndex = (key: number | undefined) => ({
        ...(sendLocations ? { locationIndex: locations.findIndex((l) => l.key === resolveLocKey(key)) } : {}),
      });
      const units = [
        ...existingUnitIds.map((id) => ({ existingUnitId: id, ...locIndex(existingLoc[id]) })),
        ...newUnits.map((u) => ({
          ...locIndex(u.locKey),
          newUnit: u.qrDulu
            ? // Hanya ruangan yang ikut; merk/model/PK/no. seri sengaja tidak dikirim (backend menolaknya di mode ini).
              { qrDulu: true, roomLocation: trimmedOrUndefined(u.roomLocation) }
            : {
                brand: trimmedOrUndefined(u.brand),
                model: trimmedOrUndefined(u.model),
                pk: numberOrUndefined(u.pk),
                roomLocation: trimmedOrUndefined(u.roomLocation),
                serialNumber: trimmedOrUndefined(u.serialNumber),
              },
        })),
      ];
      const body: Record<string, unknown> = {
        customer: {
          name: values.name.trim(),
          phone: values.phone.trim(),
          address: trimmedOrUndefined(values.address),
          mapsUrl: trimmedOrUndefined(values.mapsUrl),
          memberId: selectedMember?.id,
        },
        jobType: values.jobType,
        workDescription: trimmedOrUndefined(values.workDescription),
        complaint: trimmedOrUndefined(values.complaint),
        units,
        ...(sendLocations
          ? { locations: locations.map((l) => ({ address: trimmedOrUndefined(l.address), mapsUrl: trimmedOrUndefined(l.mapsUrl) })) }
          : {}),
        ...(technicianIds.length > 0 ? { technicianIds } : {}),
        scheduledDate: trimmedOrUndefined(values.scheduledDate),
      };
      return apiClient.post<IntakeResult>('/service-orders/intake', body);
    },
    onSuccess: (result) => {
      const many = result.jobs.length > 1;
      // Unit yang sudah terlabel (ada riwayat servis) tidak perlu cetak label lagi: kalau SEMUA unit order ini sudah
      // terlabel, langsung ke halaman job (admin maupun kasir; kasir dari sana menetapkan harga jasa). Untuk banyak
      // unit, satu halaman job memuat section tiap unit.
      if (result.unitsToLabel.length === 0) {
        toast.success(
          many
            ? `Job servis dibuat untuk ${result.jobs.length} unit AC. Semua unit sudah terlabel, tidak perlu cetak label lagi.`
            : 'Job servis dibuat. Unit AC sudah terlabel, tidak perlu cetak label lagi.',
        );
        router.push(`/teknisi/jobs/${result.jobId}`);
        return;
      }
      const hasQrDulu = newUnits.some((u) => u.qrDulu);
      toast.success(
        hasQrDulu
          ? `Job servis dibuat${many ? ` untuk ${result.jobs.length} unit AC` : ''}. Cetak & tempel label QR-nya; teknisi melengkapi data AC saat scan di lokasi.`
          : `Job servis dibuat${many ? ` untuk ${result.jobs.length} unit AC` : ''}.`,
      );
      // Unit baru (belum pernah tercatat) baru dapat barcode di titik ini: langsung ke halaman cetak label QR-nya.
      // Campuran dengan unit lama yang sudah terlabel: hanya unit yang perlu dicetak yang ikut.
      const onlySome = result.unitsToLabel.length < result.jobs.length;
      router.push(
        `/service-orders/${result.serviceOrderId}/print-labels${onlySome ? `?units=${result.unitsToLabel.join(',')}` : ''}`,
      );
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal membuat job servis.');
    },
  });

  function onSubmit(values: IntakeFormValues) {
    // Batas nomor HP standar Indonesia; dilewati bila member lama dipilih (backend memakai data member di database).
    const phoneErr = selectedMember ? null : phoneError(values.phone);
    if (phoneErr) {
      form.setError('phone', { message: phoneErr });
      return;
    }
    if (totalUnits === 0) {
      toast.error('Pilih unit yang sudah terdaftar atau tambahkan unit AC baru, minimal satu.');
      return;
    }
    for (const [i, u] of newUnits.entries()) {
      const pk = Number(u.pk);
      if (!u.qrDulu && u.pk.trim() && (Number.isNaN(pk) || pk < 0 || pk > 99.99)) {
        toast.error(`Unit baru #${i + 1}: PK harus berupa angka 0 sampai 99,99.`);
        return;
      }
    }
    intakeMutation.mutate(values);
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Terima Servis Baru</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buat job servis buat customer yang bawa/minta servis unit AC-nya sendiri - baik unit
          yang udah kebeli/terdaftar di toko ini, maupun unit lama yang belum pernah tercatat.
          Servis lebih dari satu AC dalam satu order juga bisa (tetap satu nota).
        </p>
      </div>

      {prefillNote && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm lg:max-w-2xl" role="status">
          {prefillNote}
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:max-w-2xl">
          <Card panel>
            <CardHeader>
              <CardTitle className="text-base">Data Pelanggan</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <MemberPicker value={selectedMember} onSelect={selectMember} onClear={clearSelectedMember} />

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
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card panel>
            <CardHeader>
              <CardTitle className="text-base">Titik Lokasi Kerja</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-xs text-muted-foreground">
                Isi hanya kalau AC dikerjakan di tempat yang berbeda dari alamat utama pelanggan di atas; kosongkan kalau
                sama (teknisi memakai alamat utama). Satu pelanggan bisa punya AC di beberapa tempat: tambah titik lokasi,
                lalu pilih titik tiap unit di bagian Unit AC.
              </p>
              {locations.map((loc, i) => (
                <LocationCard
                  key={loc.key}
                  loc={loc}
                  index={i}
                  canRemove={locations.length > 1}
                  onChange={(patch) => patchLocation(loc.key, patch)}
                  onCopy={() => copyMemberAddress(loc.key)}
                  onRemove={() => removeLocation(loc.key)}
                />
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={addLocation} disabled={locations.length >= MAX_LOCATIONS}>
                  <Plus className="size-4" /> Tambah titik lokasi
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card panel>
            <CardHeader>
              <CardTitle className="text-base">Unit AC</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              {selectedMember && (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Unit terdaftar milik {selectedMember.name}</p>
                  {memberDetailQuery.isLoading && (
                    <p className="text-sm text-muted-foreground">Memuat unit AC member...</p>
                  )}
                  {!memberDetailQuery.isLoading && memberUnits.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Member ini belum punya unit AC terdaftar - tambahkan sebagai unit baru di bawah.
                    </p>
                  )}
                  {memberUnits.length > 0 && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Centang semua unit yang diservis. Tiap unit dapat temuan, foto sebelum/sesudah,
                        dan riwayat servisnya sendiri.
                      </p>
                      {memberUnits.length > 1 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={selectableUnitIds.length === 0 || allExistingSelected}
                            onClick={selectAllExisting}
                          >
                            Pilih semua
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={existingUnitIds.length === 0}
                            onClick={clearExisting}
                          >
                            Kosongkan
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {existingUnitIds.length} dari {memberUnits.length} unit dipilih
                            {busyUnitCount > 0 && ` (${busyUnitCount} unit tidak bisa dipilih: masih ada job aktif)`}
                          </span>
                        </div>
                      )}
                      {unitColumns > 1 && (
                        <p className="text-xs font-medium text-muted-foreground">
                          {memberUnits.length} unit - geser ke kanan untuk melihat unit lainnya.
                        </p>
                      )}
                      <ul
                        className={cn('grid gap-2', unitColumns > 1 && 'auto-cols-[minmax(21rem,1fr)] grid-flow-col overflow-x-auto pb-2')}
                        style={unitColumns > 1 ? { gridTemplateRows: `repeat(${unitRows}, auto)` } : undefined}
                      >
                        {memberUnits.map((u) => {
                          const checked = existingUnitIds.includes(u.id);
                          const busy = (u.technicianJobs?.length ?? 0) > 0;
                          return (
                            <li key={u.id} className="grid gap-2">
                              <Label
                                htmlFor={`unit-${u.id}`}
                                className={cn(
                                  'flex items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
                                  busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                                )}
                              >
                                <Checkbox
                                  id={`unit-${u.id}`}
                                  checked={checked}
                                  disabled={busy}
                                  onCheckedChange={(v) => toggleExisting(u.id, v === true)}
                                  className="mt-0.5"
                                />
                                <span className="min-w-0 flex-1 text-sm">
                                  <span className="font-medium">
                                    {[u.brand, u.model].filter(Boolean).join(' ') || 'Unit AC'}
                                  </span>
                                  {u.roomLocation ? ` - ${u.roomLocation}` : ''}
                                  <span className="block font-mono text-xs text-muted-foreground">
                                    {u.barcodeValue}
                                  </span>
                                </span>
                                {busy && <Badge variant="secondary">Masih ada job aktif</Badge>}
                                {u.status === 'menunggu_data' && (
                                  <Badge variant="warning">{statusLabel(u.status)}</Badge>
                                )}
                              </Label>
                              {checked && locations.length > 1 && (
                                <div className="pl-3">
                                  <LocationSelect
                                    id={`unit-loc-${u.id}`}
                                    locations={locations}
                                    value={resolveLocKey(existingLoc[u.id])}
                                    onChange={(k) => setExistingLoc((cur) => ({ ...cur, [u.id]: k }))}
                                  />
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              )}

              <div className="grid gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {selectedMember && memberUnits.length > 0 ? 'Unit baru (belum tercatat)' : 'Unit AC yang diservis'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Unit AC yang belum pernah tercatat di sistem (dibeli di tempat lain, atau dibeli di
                    toko ini sebelum ada sistem ini). Barcode/QR unit baru digenerate begitu job ini
                    dibuat. Belum tahu tipenya? Pilih &quot;QR dulu&quot; - teknisi yang mengisi data
                    AC-nya saat scan di lokasi. Banyak AC? Tambah unit sebanyak yang ada.
                  </p>
                </div>

                {newUnits.map((row, idx) => (
                  <NewUnitCard
                    key={row.key}
                    row={row}
                    index={idx}
                    locations={locations}
                    resolveLocKey={resolveLocKey}
                    onChange={(patch) => patchRow(row.key, patch)}
                    onRemove={() => removeRow(row.key)}
                  />
                ))}

                {newUnits.some((u) => u.qrDulu) && (
                  <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    Unit &quot;QR dulu&quot; dibuat tanpa data tipe (status Menunggu Data). Cetak label QR-nya,
                    lalu teknisi scan di menu Scan Unit dan mengisi merk + PK sebelum memulai job. Pengingat WA
                    OFF sampai datanya lengkap.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow(false)}>
                    <Plus className="size-4" /> Tambah Unit AC
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow(true)}>
                    <QrCode className="size-4" /> Tambah Unit &quot;QR dulu&quot;
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Total {totalUnits} unit AC dalam order ini
                {totalUnits > 1 ? ' - satu nota, tiap unit jadi satu job.' : '.'}
              </p>
            </CardContent>
          </Card>

          <Card panel>
            <CardHeader>
              <CardTitle className="text-base">Keluhan &amp; Penjadwalan</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField
                control={form.control}
                name="jobType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Jenis Pekerjaan</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full sm:w-72">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="perbaikan">Perbaikan</SelectItem>
                        <SelectItem value="cuci">Cuci AC</SelectItem>
                        <SelectItem value="maintenance">Maintenance</SelectItem>
                        <SelectItem value="bongkar">Bongkar AC</SelectItem>
                        <SelectItem value="pasang">Pasang AC</SelectItem>
                        <SelectItem value="bongkar_pasang">Bongkar Pasang AC</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Berlaku untuk semua unit di order ini. Cuci AC dan Maintenance meminta siklus servis berikutnya saat
                      admin menyetujui, supaya pengingat WhatsApp terjadwal.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="workDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deskripsi Pekerjaan (opsional)</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Mis. Cuci AC rutin semua unit, ganti kapasitor, dsb." {...field} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Tampil di halaman teknisi sebagai note pekerjaan.</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="complaint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Keluhan Awal</FormLabel>
                    <FormControl>
                      <Textarea rows={3} placeholder="Mis. AC gak dingin, bunyi berisik" {...field} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Kalau tidak ada keluhan, cukup isikan pekerjaannya saja, misal: Cuci AC.
                      {totalUnits > 1
                        ? ' Dicatat sebagai temuan awal di tiap unit; teknisi bisa mengubah atau menambah temuan per unit.'
                        : ''}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isAdmin && (
                <div className="grid gap-1.5">
                  <FormLabel>Teknisi (opsional)</FormLabel>
                  <TechnicianMultiPicker technicians={technicians} value={technicianIds} onChange={setTechnicianIds} />
                </div>
              )}

              <FormField
                control={form.control}
                name="scheduledDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Jadwal</FormLabel>
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
            {intakeMutation.isPending
              ? 'Menyimpan...'
              : totalUnits > 1
                ? `Buat Job Servis (${totalUnits} unit)`
                : 'Buat Job Servis'}
          </Button>
        </form>
      </Form>
    </div>
  );
}

// Satu unit AC baru. Dua mode seperti Input Data Lampau: "Tipe diketahui" (isian opsional, boleh dikosongkan) atau
// "QR dulu" (hanya ruangan; merk/PK diisi teknisi saat scan).
function NewUnitCard({
  row,
  index,
  locations,
  resolveLocKey,
  onChange,
  onRemove,
}: {
  row: NewUnitRow;
  index: number;
  locations: WorkLocationRow[];
  resolveLocKey: (key: number | undefined) => number;
  onChange: (patch: Partial<NewUnitRow>) => void;
  onRemove: () => void;
}) {
  const id = `new-unit-${row.key}`;
  return (
    <div className="grid gap-3 rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Unit baru #{index + 1}</span>
          <Button
            type="button"
            size="sm"
            variant={row.qrDulu ? 'outline' : 'default'}
            onClick={() => onChange({ qrDulu: false })}
          >
            Tipe diketahui
          </Button>
          <Button
            type="button"
            size="sm"
            variant={row.qrDulu ? 'default' : 'outline'}
            onClick={() => onChange({ qrDulu: true })}
          >
            QR dulu (tipe belum tahu)
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Hapus unit baru #${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {!row.qrDulu && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-brand`}>Merek</Label>
            <Input
              id={`${id}-brand`}
              placeholder="Opsional"
              value={row.brand}
              onChange={(e) => onChange({ brand: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-model`}>Model</Label>
            <Input
              id={`${id}-model`}
              placeholder="Opsional"
              value={row.model}
              onChange={(e) => onChange({ model: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-pk`}>PK</Label>
            <Input
              id={`${id}-pk`}
              inputMode="decimal"
              placeholder="Opsional"
              value={row.pk}
              onChange={(e) => onChange({ pk: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-serial`}>No. Seri</Label>
            <Input
              id={`${id}-serial`}
              placeholder="Opsional"
              value={row.serialNumber}
              onChange={(e) => onChange({ serialNumber: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-room`}>Lokasi Ruangan</Label>
        <Input
          id={`${id}-room`}
          placeholder="Opsional, mis. Kamar Utama"
          value={row.roomLocation}
          onChange={(e) => onChange({ roomLocation: e.target.value })}
        />
      </div>

      {locations.length > 1 && (
        <LocationSelect
          id={`${id}-loc`}
          locations={locations}
          value={resolveLocKey(row.locKey)}
          onChange={(k) => onChange({ locKey: k })}
        />
      )}
    </div>
  );
}

// Pilihan titik lokasi kerja satu unit (hanya tampil kalau titiknya lebih dari satu).
function LocationSelect({
  id,
  locations,
  value,
  onChange,
}: {
  id: string;
  locations: WorkLocationRow[];
  value: number;
  onChange: (key: number) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">
        Titik lokasi kerja unit ini
      </Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {locations.map((l, i) => (
            <SelectItem key={l.key} value={String(l.key)}>
              {locationLabel(l, i)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Satu titik lokasi kerja: alamat/nama daerah + link Google Maps (sama dengan Data Pelanggan: tanpa link, tombol Buka di
// Maps di halaman job mencari teks alamatnya, jadi nama daerah saja sudah cukup) + salin alamat utama pelanggan.
function LocationCard({
  loc,
  index,
  canRemove,
  onChange,
  onCopy,
  onRemove,
}: {
  loc: WorkLocationRow;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<WorkLocationRow>) => void;
  onCopy: () => void;
  onRemove: () => void;
}) {
  const id = `loc-${loc.key}`;
  return (
    <div className="grid gap-3 rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Titik lokasi {index + 1}</span>
          <Button type="button" size="sm" variant="outline" onClick={onCopy}>
            <Copy className="size-4" /> Samakan dengan alamat pelanggan
          </Button>
        </div>
        {canRemove && (
          <Button type="button" variant="ghost" size="icon" aria-label={`Hapus titik lokasi ${index + 1}`} onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-address`}>Alamat / nama daerah lokasi kerja</Label>
        <Textarea
          id={`${id}-address`}
          rows={2}
          placeholder="Mis. Jl. Melati 5 Mojokerto, atau cukup nama daerah"
          value={loc.address}
          onChange={(e) => onChange({ address: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-maps`}>Link Lokasi (Google Maps)</Label>
        <Input
          id={`${id}-maps`}
          placeholder={MAPS_INPUT_PLACEHOLDER}
          value={loc.mapsUrl}
          onChange={(e) => onChange({ mapsUrl: e.target.value })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Alamat dan link boleh diketik biasa (nama daerah atau tempat pun cukup, tanpa https://): tombol Buka di Maps di halaman job
        akan membuka linknya, atau mencari teks yang diketik di Google Maps. Dikosongkan = ikut alamat utama pelanggan.
      </p>
    </div>
  );
}
