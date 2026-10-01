'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PencilLine } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import type { AcUnitDetail } from '@/components/ac-unit-detail-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Unit 'menunggu_data' (QR dibuat dulu, tipe belum diketahui): teknisi
 * WAJIB mengisi merk + PK dari kondisi AC di lokasi sebelum lanjut kerja.
 */
export function CompleteDataPanel({ data, onDone }: { data: AcUnitDetail; onDone: () => void }) {
  const unit = data.unit;
  const [brand, setBrand] = React.useState('');
  const [model, setModel] = React.useState('');
  const [pk, setPk] = React.useState('');
  const [serial, setSerial] = React.useState('');
  const [room, setRoom] = React.useState(unit.roomLocation ?? '');
  const [installed, setInstalled] = React.useState('');
  const [lastService, setLastService] = React.useState('');

  const mutation = useMutation({
    mutationFn: (payload: unknown) => apiClient.post(`/ac-units/${unit.id}/complete-data`, payload),
    onSuccess: () => {
      toast.success('Data unit tersimpan.');
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal menyimpan data unit.'),
  });

  const pkNum = Number(pk);
  const invalid = !brand.trim() || !pk.trim() || Number.isNaN(pkNum) || pkNum <= 0;

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="text-base">Lengkapi Data Unit</CardTitle>
        <CardDescription>
          Unit ini baru diberi QR dan tipe ACnya belum diketahui. Lihat langsung AC di lokasi, lalu isi data di
          bawah (merk dan PK wajib) sebelum melanjutkan pekerjaan.
        </CardDescription>
        {data.member && (
          <p className="text-sm">
            <span className="font-medium">{data.member.name}</span>
            {data.member.address ? ` · ${data.member.address}` : ''}
          </p>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <F label="Merk *"><Input value={brand} onChange={(e) => setBrand(e.target.value)} /></F>
          <F label="Model / tipe"><Input value={model} onChange={(e) => setModel(e.target.value)} /></F>
          <F label="PK *"><Input inputMode="decimal" value={pk} onChange={(e) => setPk(e.target.value)} placeholder="1, 1.5, 2" /></F>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="No. seri"><Input value={serial} onChange={(e) => setSerial(e.target.value)} /></F>
          <F label="Ruangan"><Input value={room} onChange={(e) => setRoom(e.target.value)} /></F>
          <F label="Tanggal pasang (kalau tahu)"><Input type="date" value={installed} onChange={(e) => setInstalled(e.target.value)} /></F>
          <F label="Servis terakhir (kalau tahu)"><Input type="date" value={lastService} onChange={(e) => setLastService(e.target.value)} /></F>
        </div>
        <div>
          <Button
            disabled={invalid || mutation.isPending}
            onClick={() =>
              mutation.mutate({
                brand: brand.trim(),
                pk: pkNum,
                model: model.trim() || undefined,
                serialNumber: serial.trim() || undefined,
                roomLocation: room.trim() || undefined,
                installationDate: installed || undefined,
                lastServiceDate: lastService || undefined,
              })
            }
          >
            Simpan Data Unit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface PendingCorrection {
  id: string;
  brand: string | null;
  model: string | null;
  pk: string | null;
  roomLocation: string | null;
  serialNumber: string | null;
  note: string | null;
}

/** Unit aktif: teknisi tidak mengubah data langsung — ajukan koreksi ke admin. */
export function CorrectionPanel({ data }: { data: AcUnitDetail }) {
  const unit = data.unit;
  const [open, setOpen] = React.useState(false);
  const [brand, setBrand] = React.useState(unit.brand ?? '');
  const [model, setModel] = React.useState(unit.model ?? '');
  const [pk, setPk] = React.useState(unit.pk != null ? String(Number(unit.pk)) : '');
  const [serial, setSerial] = React.useState(unit.serialNumber ?? '');
  const [room, setRoom] = React.useState(unit.roomLocation ?? '');
  const [note, setNote] = React.useState('');

  const pending = useQuery({
    queryKey: ['ac-units', unit.id, 'correction-pending'],
    queryFn: () => apiClient.get<PendingCorrection | null>(`/ac-units/${unit.id}/corrections/pending`),
  });

  const mutation = useMutation({
    mutationFn: (payload: unknown) => apiClient.post(`/ac-units/${unit.id}/corrections`, payload),
    onSuccess: () => {
      toast.success('Koreksi dikirim ke admin.');
      setOpen(false);
      pending.refetch();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal mengirim koreksi.'),
  });

  function submit() {
    const payload: Record<string, unknown> = { note: note.trim() || undefined };
    if (brand.trim() !== (unit.brand ?? '')) payload.brand = brand.trim();
    if (model.trim() !== (unit.model ?? '')) payload.model = model.trim();
    if (room.trim() !== (unit.roomLocation ?? '')) payload.roomLocation = room.trim();
    if (serial.trim() !== (unit.serialNumber ?? '')) payload.serialNumber = serial.trim();
    const pkNum = Number(pk);
    if (pk.trim() && !Number.isNaN(pkNum) && pkNum !== Number(unit.pk ?? NaN)) payload.pk = pkNum;
    if (Object.keys(payload).length === 1) {
      toast.error('Belum ada data yang diubah.');
      return;
    }
    mutation.mutate(payload);
  }

  if (pending.data) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Koreksi data unit ini sudah dikirim dan menunggu persetujuan admin.
      </p>
    );
  }

  return (
    <>
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <PencilLine className="size-4" />
          Data tidak sesuai? Ajukan koreksi
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajukan Koreksi Data Unit</DialogTitle>
            <DialogDescription>
              Ubah kolom yang salah. Data baru berlaku setelah admin menyetujui.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <F label="Merk"><Input value={brand} onChange={(e) => setBrand(e.target.value)} /></F>
              <F label="Model"><Input value={model} onChange={(e) => setModel(e.target.value)} /></F>
              <F label="PK"><Input inputMode="decimal" value={pk} onChange={(e) => setPk(e.target.value)} /></F>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="No. seri"><Input value={serial} onChange={(e) => setSerial(e.target.value)} /></F>
              <F label="Ruangan"><Input value={room} onChange={(e) => setRoom(e.target.value)} /></F>
            </div>
            <F label="Catatan untuk admin"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></F>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button disabled={mutation.isPending} onClick={submit}>Kirim Koreksi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
