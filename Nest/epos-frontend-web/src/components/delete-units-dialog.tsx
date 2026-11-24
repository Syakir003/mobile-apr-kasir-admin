'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface DeleteUnitsResult {
  deleted: number;
  deletedIds: string[];
  skipped: { id: string; barcodeValue: string | null; label: string; reason: string }[];
}

/**
 * Hapus unit AC (admin, POST /ac-units/delete): data unit yang tidak jadi dipakai (mis. "QR dulu" yang tidak pernah
 * terisi). Server hanya menghapus unit tanpa job aktif dan tanpa riwayat servis selesai; sisanya dilewati dan alasannya
 * ditampilkan di sini setelah selesai. Dipakai di halaman member dan tab Label QR (Input Data Lampau).
 */
export function DeleteUnitsDialog({
  unitIds,
  onClose,
  onDone,
}: {
  unitIds: string[];
  onClose: () => void;
  /** Dipanggil saat dialog ditutup sesudah ada hasil (mis. untuk mengosongkan centang). */
  onDone: (result: DeleteUnitsResult) => void;
}) {
  const queryClient = useQueryClient();
  const [result, setResult] = React.useState<DeleteUnitsResult | null>(null);

  const remove = useMutation({
    mutationFn: () => apiClient.post<DeleteUnitsResult>('/ac-units/delete', { unitIds }),
    onSuccess: (r) => {
      setResult(r);
      // Daftar member (jumlah unit), detail member, dan daftar Label QR.
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['unit-labels'] });
      if (r.deleted > 0) toast.success(`${r.deleted} unit AC dihapus.`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menghapus unit.'),
  });

  function close() {
    if (result) onDone(result);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !remove.isPending && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {!result ? (
          <>
            <DialogHeader>
              <DialogTitle>Hapus {unitIds.length} unit AC?</DialogTitle>
              <DialogDescription>
                Data unit dihapus permanen dan tidak bisa dikembalikan. Label QR yang sudah tertempel tidak bisa discan lagi,
                dan jumlah unit AC member berkurang. Unit yang masih punya job aktif atau sudah punya riwayat servis selesai
                tidak akan dihapus.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={remove.isPending} onClick={close}>
                Batal
              </Button>
              <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? 'Menghapus...' : `Hapus ${unitIds.length} unit`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{result.deleted > 0 ? 'Selesai' : 'Tidak ada yang dihapus'}</DialogTitle>
              <DialogDescription>
                {result.deleted} dari {unitIds.length} unit dihapus
                {result.skipped.length > 0 ? `, ${result.skipped.length} unit dilewati.` : '.'}
              </DialogDescription>
            </DialogHeader>
            {result.skipped.length > 0 && (
              <ul className="grid max-h-72 gap-2 overflow-y-auto text-sm">
                {result.skipped.map((s) => (
                  <li key={s.id} className="rounded-md border p-2">
                    <p className="font-medium">
                      {s.label}
                      {s.barcodeValue && <span className="ml-2 font-mono text-xs text-muted-foreground">{s.barcodeValue}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.reason}</p>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button type="button" onClick={close}>
                Tutup
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
