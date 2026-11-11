'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AddUnitJobType = 'perbaikan' | 'cuci' | 'maintenance' | 'bongkar' | 'pasang' | 'bongkar_pasang';
const JOB_TYPE_OPTIONS: { value: AddUnitJobType; label: string }[] = [
  { value: 'perbaikan', label: 'Perbaikan' },
  { value: 'cuci', label: 'Cuci AC' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'bongkar', label: 'Bongkar AC' },
  { value: 'pasang', label: 'Pasang AC' },
  { value: 'bongkar_pasang', label: 'Bongkar Pasang AC' },
];

// Bentuk respons POST /technician-jobs/:id/add-unit.
interface AddUnitResult {
  ok: boolean;
  jobId: string;
  unitId: string;
  barcodeValue: string;
  // AC tanpa label: QR baru, teknisi yang mencetak labelnya.
  needsLabel: boolean;
  // Unit "QR dulu": merk/PK wajib dilengkapi lewat Scan Unit sebelum unit bisa dimulai.
  needsData: boolean;
}

/**
 * "Tambah Unit AC" (teknisi, job sedang dikerjakan): customer minta AC lain ikut diservis di tempat. Unit tambahan jadi
 * job baru di order yang sama (satu nota) dengan tempat temuan + foto sebelum/sesudah sendiri. Dua jalur:
 *  - unit sudah berlabel: scan barcode-nya;
 *  - AC tanpa label: QR baru dibuat, teknisi mencetaknya (halaman cetak label teknisi), menempel, lalu scan QR itu di
 *    Scan Unit untuk mengisi merk/PK (alur "QR dulu" yang sudah ada).
 * `jobId` = job yang sedang dikerjakan teknisi ini (backend memeriksa kepemilikan dan statusnya).
 */
export function AddUnitButton({ jobId, jobType }: { jobId: string; jobType: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const defaultType: AddUnitJobType = JOB_TYPE_OPTIONS.some((o) => o.value === jobType)
    ? (jobType as AddUnitJobType)
    : 'perbaikan';
  const [type, setType] = React.useState<AddUnitJobType>(defaultType);
  const [complaint, setComplaint] = React.useState('');
  const [mode, setMode] = React.useState<'scan' | 'baru'>('scan');
  const [code, setCode] = React.useState('');
  const [room, setRoom] = React.useState('');

  function reset() {
    setType(defaultType);
    setComplaint('');
    setMode('scan');
    setCode('');
    setRoom('');
  }

  const mutation = useMutation({
    mutationFn: (body: { barcode?: string; newUnit?: boolean; roomLocation?: string }) =>
      apiClient.post<AddUnitResult>(`/technician-jobs/${jobId}/add-unit`, {
        ...body,
        jobType: type,
        complaint: complaint.trim(),
      }),
    onSuccess: (r) => {
      // Seluruh awalan 'technician-jobs': job ini, antrian, dan section unit baru di halaman job.
      queryClient.invalidateQueries({ queryKey: ['technician-jobs'] });
      setOpen(false);
      reset();
      if (r.needsLabel) {
        toast.success('Unit baru ditambahkan. Cetak labelnya, tempel di AC, lalu scan QR-nya di Scan Unit untuk mengisi merk & PK.');
        router.push(`/teknisi/jobs/${jobId}/print-labels?units=${r.unitId}`);
        return;
      }
      toast.success(
        r.needsData
          ? 'Unit ditambahkan. Lengkapi merk & PK lewat Scan Unit sebelum unit ini bisa dimulai.'
          : 'Unit ditambahkan. Isi temuan dan foto sebelum/sesudahnya di bagian unit tersebut.',
      );
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menambah unit.');
    },
  });

  const complaintOk = complaint.trim().length > 0;

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Tambah Unit AC
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah Unit AC ke Job Ini</DialogTitle>
            <DialogDescription>
              Customer minta AC lain ikut diservis. Unit tambahan masuk ke job yang sama (satu nota), dengan tempat
              temuan dan foto sebelum/sesudahnya sendiri.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="add-unit-type">Jenis pekerjaan</Label>
              <Select value={type} onValueChange={(v) => setType(v as AddUnitJobType)}>
                <SelectTrigger id="add-unit-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="add-unit-complaint">Pekerjaan / keluhan unit ini</Label>
              <Textarea
                id="add-unit-complaint"
                rows={2}
                placeholder="Mis. AC kurang dingin, atau Cuci AC"
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Wajib. Kalau tidak ada keluhan, cukup isikan pekerjaannya, misal: Cuci AC. Isinya jadi temuan awal unit
                ini.
              </p>
            </div>

            <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="scan">Sudah berlabel</TabsTrigger>
                <TabsTrigger value="baru">AC tanpa label</TabsTrigger>
              </TabsList>

              <TabsContent value="scan" className="mt-3 grid gap-3">
                <p className="text-xs text-muted-foreground">
                  Scan QR/barcode yang tertempel di AC. Unit harus milik pelanggan yang sama dan tidak sedang punya job
                  lain.
                </p>
                <BarcodeScanner onDetect={(c) => setCode(c)} manualPlaceholder="Barcode unit" />
                {code && (
                  <p className="text-xs text-muted-foreground">
                    Kode terbaca: <span className="font-medium text-foreground">{code}</span>
                  </p>
                )}
                <Button
                  type="button"
                  disabled={!code.trim() || !complaintOk || mutation.isPending}
                  onClick={() => mutation.mutate({ barcode: code.trim() })}
                >
                  {mutation.isPending ? 'Memproses...' : 'Tambahkan Unit'}
                </Button>
                {!complaintOk && code && (
                  <p className="text-xs text-muted-foreground">Isi pekerjaan/keluhan dulu untuk menambahkan unit.</p>
                )}
              </TabsContent>

              <TabsContent value="baru" className="mt-3 grid gap-3">
                <p className="text-xs text-muted-foreground">
                  Untuk AC yang belum pernah ditangani dan belum punya label. QR baru dibuat dan langsung bisa kamu
                  cetak. Setelah dicetak dan ditempel di AC, scan QR itu di menu Scan Unit untuk mengisi merk dan PK.
                  AC ini otomatis masuk daftar AC pelanggan.
                </p>
                <div className="grid gap-1.5">
                  <Label htmlFor="add-unit-room">Ruangan (opsional)</Label>
                  <Input
                    id="add-unit-room"
                    placeholder="Mis. Kamar Utama"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  disabled={!complaintOk || mutation.isPending}
                  onClick={() => mutation.mutate({ newUnit: true, ...(room.trim() ? { roomLocation: room.trim() } : {}) })}
                >
                  {mutation.isPending ? 'Memproses...' : 'Buat QR Baru & Cetak Label'}
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
