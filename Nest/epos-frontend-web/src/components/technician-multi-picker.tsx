'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Maksimal teknisi per job (sama dengan batas backend). */
export const MAX_TECHNICIANS = 5;

export interface TechnicianOption {
  id: string;
  displayName: string;
}

interface BusyJob {
  jobId: string;
  customerName: string | null;
  location: string | null;
}
interface WorkloadRow {
  technicianId: string;
  jobs: BusyJob[];
}

/** Nama semua teknisi sebuah job ("Ani, Budi"); jatuh ke satu teknisi lama / "Belum ditugaskan". */
export function technicianNames(job: {
  technicians?: TechnicianOption[];
  technician?: { displayName: string } | null;
}): string {
  if (job.technicians?.length) return job.technicians.map((t) => t.displayName).join(', ');
  return job.technician?.displayName || 'Belum ditugaskan';
}

/** Teks konfirmasi saat admin/kasir memilih teknisi yang sedang mengerjakan job lain. */
export function busyWarningText(name: string, jobs: BusyJob[]): string {
  const first = jobs[0];
  const who = first.customerName ? ` untuk ${first.customerName}` : '';
  const where = first.location ? ` (${first.location})` : '';
  const more = jobs.length > 1 ? ` dan ${jobs.length - 1} job lain` : '';
  return `${name} sedang mengerjakan job${who}${where}${more}. Tetap tugaskan?`;
}

/**
 * Pilih beberapa teknisi (semua setara, maks 5). Teknisi yang sedang mengerjakan job lain (status sedang_dikerjakan,
 * dari GET /technician-jobs/workload — admin & kasir saja) diberi lencana; memilihnya meminta konfirmasi dulu tapi
 * tetap boleh. `excludeJobId` = job yang sedang diatur (pekerjaannya sendiri tidak dihitung sebagai "sibuk").
 */
export function TechnicianMultiPicker({
  technicians,
  value,
  onChange,
  excludeJobId,
  disabled,
}: {
  technicians: TechnicianOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  excludeJobId?: string;
  disabled?: boolean;
}) {
  const workload = useQuery({
    queryKey: ['technician-jobs', 'workload'],
    queryFn: () => apiClient.get<WorkloadRow[]>('/technician-jobs/workload'),
    staleTime: 15_000,
  });
  const busy = new Map<string, BusyJob[]>();
  for (const row of workload.data ?? []) {
    const jobs = row.jobs.filter((j) => j.jobId !== excludeJobId);
    if (jobs.length > 0) busy.set(row.technicianId, jobs);
  }

  function toggle(t: TechnicianOption, checked: boolean) {
    if (!checked) {
      onChange(value.filter((id) => id !== t.id));
      return;
    }
    const jobs = busy.get(t.id);
    // window.confirm: sama dengan konfirmasi alih tugas di handover.tsx.
    if (jobs && !window.confirm(busyWarningText(t.displayName, jobs))) return;
    onChange([...value, t.id]);
  }

  if (technicians.length === 0) {
    return <p className="text-xs text-muted-foreground">Belum ada teknisi aktif</p>;
  }
  return (
    <div className="grid gap-1.5">
      <div className="grid gap-1 rounded-md border p-2">
        {technicians.map((t) => {
          const checked = value.includes(t.id);
          const full = !checked && value.length >= MAX_TECHNICIANS;
          return (
            <label
              key={t.id}
              className="flex items-center gap-2 rounded-sm px-1 py-1 text-sm hover:bg-muted/50 has-[:disabled]:opacity-50"
            >
              <Checkbox
                checked={checked}
                disabled={disabled || full}
                onCheckedChange={(c) => toggle(t, c === true)}
                aria-label={`Pilih teknisi ${t.displayName}`}
              />
              <span className="flex-1">{t.displayName}</span>
              {busy.has(t.id) && <Badge variant="warning">Sedang mengerjakan</Badge>}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length}/{MAX_TECHNICIANS} teknisi dipilih. Semua teknisi yang dipilih sama-sama melihat dan mengerjakan job.
      </p>
    </div>
  );
}

/**
 * Tombol + dialog "Tugaskan teknisi" untuk daftar job (admin). Menyimpan SET PENUH teknisi lewat
 * PATCH /technician-jobs/:id/assign; `allInOrder` = servis banyak AC (semua unit yang belum selesai).
 */
export function TechnicianAssignDialog({
  jobId,
  allInOrder,
  current,
  technicians,
}: {
  jobId: string;
  allInOrder?: boolean;
  current: string[];
  technicians: TechnicianOption[];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>(current);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/technician-jobs/${jobId}/assign`, {
        technicianIds: selected,
        ...(allInOrder ? { allInOrder: true } : {}),
      }),
    onSuccess: () => {
      toast.success('Teknisi ditugaskan.');
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['technician-jobs'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menugaskan teknisi.');
    },
  });

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setSelected(current);
          setOpen(true);
        }}
      >
        {current.length > 0 ? 'Ubah teknisi' : allInOrder ? 'Tugaskan (semua unit)' : 'Tugaskan teknisi'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tugaskan teknisi</DialogTitle>
            <DialogDescription>
              Pilih satu atau beberapa teknisi.{allInOrder ? ' Berlaku untuk semua unit yang belum selesai.' : ''}
            </DialogDescription>
          </DialogHeader>
          <TechnicianMultiPicker
            technicians={technicians}
            value={selected}
            onChange={setSelected}
            excludeJobId={jobId}
            disabled={mutation.isPending}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="button" disabled={selected.length === 0 || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
