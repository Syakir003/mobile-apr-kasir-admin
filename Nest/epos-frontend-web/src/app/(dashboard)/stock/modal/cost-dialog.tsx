'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CostRow {
  itemCostIds: string[];
  kind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  buyPrice: number | null;
  sellPrice: number;
  qtyReceived: number | null;
  supplierName: string | null;
  createdAt: string;
  createdByName: string | null;
}

type SetCostResult =
  | { status: 'ok'; updatedInvoiceNumbers: string[] }
  | { status: 'confirm_required' };

// 'isi' = form; 'koreksi' = konfirmasi mengubah harga lama; 'rugi' = server
// minta konfirmasi karena modal tidak di bawah harga jual.
type Step = 'isi' | 'koreksi' | 'rugi';

export function CostDialog({ row, onClose }: { row: CostRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = React.useState(row.buyPrice === null ? '' : String(row.buyPrice));
  const [supplier, setSupplier] = React.useState(row.supplierName ?? '');
  const [step, setStep] = React.useState<Step>('isi');
  const value = Number(price);
  const valid = price.trim() !== '' && Number.isFinite(value) && value >= 0;

  const mutation = useMutation({
    mutationFn: (confirmOverride: boolean) => {
      const [first, ...rest] = row.itemCostIds;
      return apiClient.put<SetCostResult>(`/stock/batches/${first}/cost`, {
        buyPrice: value,
        ...(supplier.trim() ? { supplierName: supplier.trim() } : {}),
        ...(rest.length ? { alsoItemCostIds: rest } : {}),
        ...(confirmOverride ? { confirmOverride: true } : {}),
      });
    },
    onSuccess: (result) => {
      if (result.status === 'confirm_required') {
        setStep('rugi');
        return;
      }
      toast.success(
        result.updatedInvoiceNumbers.length
          ? `Modal tersimpan. Invoice diperbarui: ${result.updatedInvoiceNumbers.join(', ')}`
          : 'Modal tersimpan.',
      );
      for (const key of ['stock-costs', 'products', 'product-batches', 'spareparts', 'sparepart-batches']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan modal.'),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    if (row.buyPrice !== null && value !== row.buyPrice) setStep('koreksi');
    else mutation.mutate(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row.buyPrice === null ? 'Isi harga modal' : 'Ubah harga modal'}</DialogTitle>
          <DialogDescription>{row.name}</DialogDescription>
        </DialogHeader>

        {step === 'isi' ? (
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="buyPrice">Harga modal per {row.unit}</Label>
              {/* Sparepart bisa berpecahan (mis. Rp933,33 per meter) — CurrencyInput membuang desimal. */}
              {row.kind === 'product' ? (
                <CurrencyInput id="buyPrice" value={price} onChange={setPrice} autoFocus />
              ) : (
                <Input
                  id="buyPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  autoFocus
                />
              )}
              <p className="text-xs text-muted-foreground">Harga jual: {formatRupiah(row.sellPrice)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supplier">Pemasok (opsional)</Label>
              <Input id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Batal
              </Button>
              <Button type="submit" disabled={!valid || mutation.isPending}>
                Simpan
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1 text-sm">
              {row.buyPrice !== null && (
                <p>
                  Harga lama: <strong>{formatRupiah(row.buyPrice)}</strong>
                </p>
              )}
              <p>
                Harga baru: <strong>{formatRupiah(value)}</strong>
              </p>
              <p className="text-muted-foreground">
                {step === 'rugi'
                  ? `Modal ini tidak di bawah harga jual (${formatRupiah(row.sellPrice)}). Tetap simpan?`
                  : 'Laporan penjualan lama ikut berubah.'}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep('isi')}>
                Kembali
              </Button>
              <Button
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(step === 'rugi')}
              >
                {step === 'rugi' ? 'Tetap Simpan' : 'Ya, Ubah'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
