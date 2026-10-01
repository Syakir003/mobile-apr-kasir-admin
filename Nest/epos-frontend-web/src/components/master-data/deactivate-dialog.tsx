'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Dialog konfirmasi generik buat toggle `active` (nonaktifkan / aktifkan
// lagi) item Master Data — dipakai di 4 halaman (Produk, Sparepart, Jasa,
// Paket Instalasi). BUKAN hapus permanen: cuma PATCH { active } yang emang
// udah ada di 4 endpoint update, riwayat transaksi lama tetap aman.
export function DeactivateDialog({
  open,
  onOpenChange,
  itemName,
  willActivate,
  stockWarning,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  /** true = aksi AKTIFKAN KEMBALI (item lagi nonaktif). false = aksi NONAKTIFKAN. */
  willActivate: boolean;
  /** Pesan warning stok — cuma dikirim buat Produk/Sparepart yang stoknya > 0. */
  stockWarning?: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {willActivate ? 'Aktifkan kembali' : 'Nonaktifkan'} &ldquo;{itemName}&rdquo;?
          </DialogTitle>
          <DialogDescription>
            {willActivate
              ? 'Item ini bakal muncul lagi di POS/pemilihan setelah diaktifkan.'
              : 'Item yang dinonaktifkan gak akan muncul lagi di POS/pemilihan, tapi riwayat transaksinya tetap aman dan bisa diaktifkan lagi kapan aja lewat filter status.'}
          </DialogDescription>
        </DialogHeader>
        {!willActivate && stockWarning && (
          <p className="rounded-md border border-dashed border-amber-500 bg-amber-50 p-3 text-sm text-amber-800">
            {stockWarning}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Batal
          </Button>
          <Button
            variant={willActivate ? 'default' : 'destructive'}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Menyimpan...' : willActivate ? 'Ya, Aktifkan' : 'Ya, Nonaktifkan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
