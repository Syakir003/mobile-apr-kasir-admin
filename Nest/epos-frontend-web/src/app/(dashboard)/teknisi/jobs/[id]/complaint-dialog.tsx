'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquareWarning } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { wibDateKey } from '@/lib/wib-date';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

export interface ComplaintJob {
  id: string;
  status: string;
  technician: { id: string } | null;
  unit: { brand: string | null; model: string | null; roomLocation: string | null } | null;
}
export interface ComplaintTechnician {
  id: string;
  displayName: string;
}

// Nilai khusus pilihan "Belum ditentukan" (Radix Select tidak menerima nilai string kosong).
const NO_TECHNICIAN = '__none__';

const unitLabel = (j: ComplaintJob) =>
  `${[j.unit?.brand, j.unit?.model].filter(Boolean).join(' ') || 'Unit AC'}${j.unit?.roomLocation ? ` (${j.unit.roomLocation})` : ''}`;

// Jadwal bawaan = hari ini (WIB); dihitung di fungsi terpisah supaya tidak memanggil Date saat render.
const todayKey = () => wibDateKey(new Date());

/**
 * Tombol "Komplain" di kartu Detail Order (khusus admin) + dialognya. Dari job yang sudah SELESAI, admin membuat job
 * komplain baru tanpa mengisi ulang data: pelanggan, unit, dan lokasi kerja disalin. Yang diisi hanya unit mana yang
 * dikomplain, keluhannya, jadwal, dan (opsional) teknisinya. Job awal tidak berubah; job komplain punya temuan & foto
 * sebelum/sesudah sendiri, teknisi tetap scan unit dulu, dan tidak ada harga jasa atau tagihan baru
 * (POST /technician-jobs/:id/complaint). Tombol hilang selama belum ada job selesai di order ini.
 */
export function ComplaintButton({
  anchorJobId,
  jobs,
  technicians,
}: {
  anchorJobId: string;
  jobs: ComplaintJob[];
  technicians: ComplaintTechnician[];
}) {
  const [open, setOpen] = React.useState(false);
  const finished = jobs.filter((j) => j.status === 'selesai');
  if (finished.length === 0) return null;
  return (
    <>
      {/* Blok di bagian bawah kartu Detail Order: catatan miring + tombol. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="min-w-0 flex-1 basis-56 text-xs italic text-muted-foreground">
          Gunakan tombol ini untuk membuat ulang job jika ada customer komplain.
        </p>
        <Button
          variant="destructive"
          size="sm"
          title="Buat job komplain dari pekerjaan yang sudah selesai"
          onClick={() => setOpen(true)}
        >
          <MessageSquareWarning className="size-4" />
          Komplain
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Komplain Pelanggan</DialogTitle>
            <DialogDescription>
              Membuat job baru dari pekerjaan yang sudah selesai ini, tanpa mengisi ulang data. Hasil pekerjaan awal
              (temuan, foto, tagihan) tidak diubah. Job komplain punya temuan dan foto sebelum/sesudah sendiri, teknisi
              tetap harus scan unit dulu, dan tidak ada harga jasa atau tagihan baru.
            </DialogDescription>
          </DialogHeader>
          <ComplaintForm
            anchorJobId={anchorJobId}
            finished={finished}
            technicians={technicians}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ComplaintForm({
  anchorJobId,
  finished,
  technicians,
  onDone,
}: {
  anchorJobId: string;
  finished: ComplaintJob[];
  technicians: ComplaintTechnician[];
  onDone: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Satu unit selesai: langsung terpilih. Beberapa unit: admin memilih unit yang dikomplain (jangan membuat job yang tidak perlu).
  const [picked, setPicked] = React.useState<Set<string>>(() => (finished.length === 1 ? new Set([finished[0].id]) : new Set()));
  const [complaint, setComplaint] = React.useState('');
  // Teknisi bawaan = teknisi pekerjaan awal (bila masih aktif), seperti yang dilakukan backend.
  const [technicianId, setTechnicianId] = React.useState(() => {
    const prev = finished[0]?.technician?.id;
    return prev && technicians.some((t) => t.id === prev) ? prev : NO_TECHNICIAN;
  });
  const [date, setDate] = React.useState(todayKey);
  const [errors, setErrors] = React.useState<{ units?: string; complaint?: string; date?: string }>({});

  const create = useMutation({
    mutationFn: (body: object) =>
      apiClient.post<{ jobId: string; orderId: string; jobs: { jobId: string }[] }>(
        `/technician-jobs/${anchorJobId}/complaint`,
        body,
      ),
    onSuccess: (r) => {
      toast.success(
        r.jobs.length > 1 ? `Job komplain dibuat untuk ${r.jobs.length} unit.` : 'Job komplain dibuat.',
      );
      queryClient.invalidateQueries({ queryKey: ['technician-jobs'] });
      onDone();
      router.push(`/teknisi/jobs/${r.jobId}`);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal membuat job komplain.');
    },
  });

  function toggle(id: string, on: boolean) {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (picked.size === 0) next.units = 'Pilih minimal satu unit yang dikomplain';
    if (!complaint.trim()) next.complaint = 'Keluhan wajib diisi';
    if (!date) next.date = 'Jadwal wajib diisi';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate({
      jobIds: finished.filter((j) => picked.has(j.id)).map((j) => j.id),
      complaint: complaint.trim(),
      technicianId: technicianId === NO_TECHNICIAN ? null : technicianId,
      scheduledDate: date,
    });
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Unit yang dikomplain</p>
          {finished.length > 1 && (
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setPicked(picked.size === finished.length ? new Set() : new Set(finished.map((j) => j.id)))}
            >
              {picked.size === finished.length ? 'Kosongkan' : 'Pilih semua'}
            </button>
          )}
        </div>
        <ul className="grid max-h-[30vh] gap-1.5 overflow-y-auto pr-1">
          {finished.map((j) => (
            <li key={j.id}>
              <Label
                htmlFor={`komplain-${j.id}`}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md border p-2.5 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
                )}
              >
                <Checkbox
                  id={`komplain-${j.id}`}
                  checked={picked.has(j.id)}
                  onCheckedChange={(v) => toggle(j.id, v === true)}
                />
                <span className="min-w-0 flex-1 text-sm">{unitLabel(j)}</span>
              </Label>
            </li>
          ))}
        </ul>
        {errors.units && <p className="text-xs text-destructive">{errors.units}</p>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="komplain-keluhan">Keluhan pelanggan</Label>
        <Textarea
          id="komplain-keluhan"
          rows={3}
          maxLength={500}
          value={complaint}
          onChange={(e) => setComplaint(e.target.value)}
          placeholder="Mis. AC masih bocor / kurang dingin setelah dicuci"
          aria-invalid={!!errors.complaint}
        />
        <p className="text-xs text-muted-foreground">
          Jadi temuan awal baru di tiap unit (terpisah dari temuan pekerjaan awal), tempat foto sebelum/sesudah yang baru.
        </p>
        {errors.complaint && <p className="text-xs text-destructive">{errors.complaint}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="komplain-teknisi">Teknisi</Label>
          <Select value={technicianId} onValueChange={setTechnicianId}>
            <SelectTrigger id="komplain-teknisi" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TECHNICIAN}>Belum ditentukan</SelectItem>
              {technicians.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="komplain-jadwal">Jadwal</Label>
          <Input
            id="komplain-jadwal"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={!!errors.date}
          />
          {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
          Batal
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Membuat...' : 'Buat Job Komplain'}
        </Button>
      </DialogFooter>
    </form>
  );
}
