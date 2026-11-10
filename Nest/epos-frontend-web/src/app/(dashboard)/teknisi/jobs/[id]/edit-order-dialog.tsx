'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { MAPS_INPUT_PLACEHOLDER, mapsInputDisplay } from '@/lib/maps-input';
import { wibDateKey } from '@/lib/wib-date';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const FINISHED = ['selesai', 'dibatalkan'];
const PAYMENT_MODE_OPTIONS = [
  { value: 'ditagih_admin', label: 'Ditagih admin (instansi/langganan)' },
  { value: 'bayar_di_lokasi', label: 'Bayar di lokasi (teknisi menagih)' },
] as const;
const TYPE_OPTIONS = [
  { value: 'perbaikan', label: 'Perbaikan' },
  { value: 'cuci', label: 'Cuci AC' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'pemasangan_jasa', label: 'Pemasangan (jasa pasang)' },
] as const;

export interface EditableOrderJob {
  id: string;
  status: string;
  type: string;
  scheduledDate: string | null;
  workAddress?: string | null;
  workMapsUrl?: string | null;
  // Job komplain: jenis pekerjaannya tetap Perbaikan (tidak ditagih, tidak mengubah jadwal pengingat).
  complaintOfJobId?: string | null;
  unit: { brand: string | null; model: string | null; roomLocation: string | null } | null;
}

const unitLabel = (j: EditableOrderJob) =>
  `${[j.unit?.brand, j.unit?.model].filter(Boolean).join(' ') || 'Unit AC'}${j.unit?.roomLocation ? ` (${j.unit.roomLocation})` : ''}`;

/**
 * Tombol pensil + dialog "Ubah Detail Order" (khusus admin): koreksi data yang salah dimasukkan saat Terima Servis.
 * Jadwal, jenis pekerjaan, dan Note Pekerjaan berlaku untuk SELURUH order; titik lokasi kerja diatur per unit. Hanya job
 * yang belum selesai/dibatalkan yang bisa diubah (PATCH /service-orders/:id). Data pelanggan diubah lewat halaman Member.
 */
export function EditOrderButton({
  orderId,
  memberId,
  note,
  paymentMode,
  jobs,
}: {
  orderId: string;
  memberId?: string | null;
  note?: string | null;
  // Cara tagih order; bawaan 'ditagih_admin' bila tidak diketahui.
  paymentMode?: string | null;
  jobs: EditableOrderJob[];
}) {
  const [open, setOpen] = React.useState(false);
  const editable = jobs.filter((j) => !FINISHED.includes(j.status));
  // Order yang semua jobnya sudah selesai/dibatalkan tidak bisa diubah lagi (backend juga menolak).
  if (editable.length === 0) return null;
  return (
    <>
      <Button variant="ghost" size="icon" title="Ubah detail order" aria-label="Ubah detail order" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ubah Detail Order</DialogTitle>
            <DialogDescription>
              Jadwal, jenis pekerjaan, dan note berlaku untuk seluruh unit di order ini. Salah data pelanggan (nama, HP,
              alamat utama)?{' '}
              {memberId ? (
                <Link href={`/members/${memberId}`} className="font-medium text-primary underline">
                  Ubah di halaman Member
                </Link>
              ) : (
                'Ubah di halaman Member.'
              )}
            </DialogDescription>
          </DialogHeader>
          <EditOrderForm
            orderId={orderId}
            note={note ?? ''}
            paymentMode={paymentMode ?? 'ditagih_admin'}
            jobs={editable}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditOrderForm({
  orderId,
  note,
  paymentMode,
  jobs,
  onDone,
}: {
  orderId: string;
  note: string;
  paymentMode: string;
  jobs: EditableOrderJob[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const first = jobs[0];
  const isPemasangan = jobs.some((j) => j.type === 'pemasangan');
  const isKomplain = jobs.some((j) => !!j.complaintOfJobId);
  const initialDate = first.scheduledDate ? wibDateKey(first.scheduledDate) : '';
  const [date, setDate] = React.useState(initialDate);
  const [jobType, setJobType] = React.useState(first.type);
  const [noteText, setNoteText] = React.useState(note);
  const [payMode, setPayMode] = React.useState(paymentMode);
  const initialLoc = React.useMemo(
    () =>
      Object.fromEntries(
        jobs.map((j) => [j.id, { address: j.workAddress ?? '', mapsUrl: mapsInputDisplay(j.workMapsUrl) }]),
      ) as Record<string, { address: string; mapsUrl: string }>,
    [jobs],
  );
  const [loc, setLoc] = React.useState(initialLoc);
  const [dateError, setDateError] = React.useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: object) => apiClient.patch(`/service-orders/${orderId}`, body),
    onSuccess: () => {
      toast.success('Data order diperbarui.');
      // Seluruh awalan 'technician-jobs': tiap unit di halaman ini, daftar job, dan antrean.
      queryClient.invalidateQueries({ queryKey: ['technician-jobs'] });
      // Cara tagih berubah: kartu Pembayaran di Lokasi ikut diperbarui.
      queryClient.invalidateQueries({ queryKey: ['field-payments'] });
      onDone();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan perubahan.');
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) {
      setDateError('Jadwal wajib diisi');
      return;
    }
    setDateError(null);
    // Hanya kirim yang berubah supaya catatan audit bersih dan tidak menimpa data yang sama.
    const changedLocs = jobs
      .filter((j) => {
        const a = loc[j.id];
        const b = initialLoc[j.id];
        return a.address.trim() !== b.address.trim() || a.mapsUrl.trim() !== b.mapsUrl.trim();
      })
      .map((j) => ({ jobId: j.id, address: loc[j.id].address.trim(), mapsUrl: loc[j.id].mapsUrl.trim() }));
    const body = {
      ...(date !== initialDate ? { scheduledDate: date } : {}),
      ...(!isPemasangan && !isKomplain && jobType !== first.type ? { jobType } : {}),
      ...(noteText.trim() !== note.trim() ? { note: noteText.trim() } : {}),
      ...(!isPemasangan && payMode !== paymentMode ? { paymentMode: payMode } : {}),
      ...(changedLocs.length > 0 ? { unitLocations: changedLocs } : {}),
    };
    if (Object.keys(body).length === 0) {
      toast.info('Tidak ada yang diubah.');
      onDone();
      return;
    }
    save.mutate(body);
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-1.5">
        <Label htmlFor="order-date">Jadwal</Label>
        <Input
          id="order-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-invalid={!!dateError}
        />
        {dateError && <p className="text-xs text-destructive">{dateError}</p>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="order-type">Jenis Pekerjaan</Label>
        {isPemasangan || isKomplain ? (
          <>
            <Input id="order-type" value={isKomplain ? 'Perbaikan (komplain)' : 'Pemasangan'} disabled />
            <p className="text-xs text-muted-foreground">
              {isKomplain
                ? 'Jenis job komplain tidak bisa diubah (tanpa tagihan, tidak mengubah jadwal pengingat).'
                : 'Jenis pemasangan tidak bisa diubah (ditagih lewat invoice POS).'}
            </p>
          </>
        ) : (
          <Select value={jobType} onValueChange={setJobType}>
            <SelectTrigger id="order-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!isPemasangan && (
        <div className="grid gap-1.5">
          <Label htmlFor="order-pay-mode">Cara Tagih</Label>
          <Select value={payMode} onValueChange={setPayMode}>
            <SelectTrigger id="order-pay-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Bayar di lokasi: teknisi mencatat pembayaran dan memberi Tanda Terima, lalu admin memverifikasi setorannya.
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="order-note">Note Pekerjaan</Label>
        <Textarea
          id="order-note"
          rows={3}
          maxLength={2000}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Opsional - kosongkan untuk menghapus note"
        />
      </div>

      <div className="grid gap-2">
        <div>
          <p className="text-sm font-medium">Titik Lokasi Kerja per Unit</p>
          <p className="text-xs text-muted-foreground">
            Isi bila lokasi unit berbeda dari alamat utama pelanggan. Kosongkan alamat dan link = ikut alamat pelanggan.
          </p>
        </div>
        <div className="grid max-h-[40vh] gap-3 overflow-y-auto pr-1">
          {jobs.map((j) => (
            <div key={j.id} className="grid gap-1.5 rounded-md border p-3">
              <p className="text-sm font-medium">{unitLabel(j)}</p>
              <Input
                aria-label={`Alamat lokasi kerja ${unitLabel(j)}`}
                placeholder="Alamat lokasi kerja (kosong = ikut alamat pelanggan)"
                value={loc[j.id].address}
                onChange={(e) => setLoc((cur) => ({ ...cur, [j.id]: { ...cur[j.id], address: e.target.value } }))}
              />
              <Input
                aria-label={`Link lokasi kerja ${unitLabel(j)}`}
                placeholder={MAPS_INPUT_PLACEHOLDER}
                value={loc[j.id].mapsUrl}
                onChange={(e) => setLoc((cur) => ({ ...cur, [j.id]: { ...cur[j.id], mapsUrl: e.target.value } }))}
              />
            </div>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>
          Batal
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </DialogFooter>
    </form>
  );
}
