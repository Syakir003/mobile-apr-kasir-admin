'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiClient, ApiError } from '@/lib/api-client';

/**
 * Gudang membetulkan barang yang masih "menunggu harga": nama, kategori, dan SKU (hanya sparepart; SKU produk dibuat
 * server). Harga tetap urusan admin, dan server menolak bila barangnya sudah diberi harga.
 * Pasang hanya saat dipakai (`{item && <FixPendingDialog .../>}`) supaya isiannya mulai dari data barang itu.
 */
export function FixPendingDialog({
  path,
  item,
  withSku = false,
  onClose,
  onSaved,
}: {
  path: string;
  item: { name: string; category?: string | null; sku?: string | null };
  withSku?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(item.name);
  const [sku, setSku] = React.useState(item.sku ?? '');
  const [category, setCategory] = React.useState(item.category ?? '');
  const [busy, setBusy] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Nama wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      await apiClient.patch(path, {
        name: name.trim(),
        category: category.trim(),
        ...(withSku ? { sku: sku.trim() } : {}),
      });
      toast.success('Perubahan disimpan.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan.');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Betulkan barang</DialogTitle>
          <DialogDescription>Harga diisi admin.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={save}>
          <label className="grid gap-1.5 text-sm font-medium">
            Nama
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {withSku && (
            <label className="grid gap-1.5 text-sm font-medium">
              SKU
              <Input placeholder="Opsional" value={sku} onChange={(e) => setSku(e.target.value)} />
            </label>
          )}
          <label className="grid gap-1.5 text-sm font-medium">
            Kategori
            <Input placeholder="Opsional" value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
