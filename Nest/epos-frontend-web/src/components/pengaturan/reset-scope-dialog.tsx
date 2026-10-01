'use client';

import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Dialog konfirmasi "ketik ulang teks" buat 1 scope reset database — dipakai
// 3x di pengaturan/page.tsx (Reset Transaksi / +Pelanggan / Total). Tombol
// konfirmasi CUMA aktif kalau isi Input persis sama (case-sensitive) dengan
// `confirmPhrase` — mekanisme yang dipilih user (bukan password, bukan
// Ya/Batal biasa) khusus karena aksi ini destruktif & gak bisa di-undo.
export function ResetScopeDialog({
  open,
  onOpenChange,
  title,
  dataList,
  confirmPhrase,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Daftar data yang bakal kehapus — ditampilkan sebagai bullet-list text. */
  dataList: string[];
  confirmPhrase: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const [typed, setTyped] = React.useState('');

  // Reset input tiap kali dialog dibuka/ditutup — biar gak ada state basi
  // yang ke-carry ke scope lain (mis. udah ketik "HAPUS TOTAL" lalu buka
  // dialog "Reset Transaksi" tanpa sengaja langsung aktif).
  React.useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const matches = typed === confirmPhrase;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-destructive">{title}</DialogTitle>
          <DialogDescription>
            Aksi ini <strong>PERMANEN</strong> dan <strong>TIDAK BISA DIBATALKAN</strong>. Gak ada
            fitur backup otomatis — pastikan kamu memang mau menghapus data-data berikut:
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {dataList.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <div className="grid gap-2 rounded-md border border-dashed border-destructive/50 bg-destructive/5 p-3">
          <Label htmlFor="reset-confirm-input" className="text-sm">
            Ketik <strong>{confirmPhrase}</strong> untuk konfirmasi:
          </Label>
          <Input
            id="reset-confirm-input"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmPhrase}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Batal
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!matches || isPending}
          >
            {isPending ? 'Menghapus...' : 'Ya, Hapus Permanen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
