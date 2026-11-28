'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { listWithPending } from '@/lib/pending-price';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { LoadingBlock } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Product {
  id: string;
  name: string;
  stock: number;
  active: boolean;
  sellPrice: string;
  acRole?: string | null;
  pendingPrice?: boolean;
}

/** Opname produk AC: ketik jumlah yang benar. Kalau lebih sedikit dari catatan, server menandai unit yang paling baru
 * masuk sebagai dihapus dan mengembalikan kodenya supaya labelnya dicabut. Menambah unit lewat Barang Masuk. */
export function ProductOpname() {
  const queryClient = useQueryClient();
  // ?produk=... = dibuka dari daftar produk dengan barang sudah terpilih.
  const [selectedId, setSelectedId] = React.useState<string | null>(useSearchParams().get('produk'));
  const [search, setSearch] = React.useState('');
  const [value, setValue] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);
  const [removed, setRemoved] = React.useState<string[]>([]);

  const productsQuery = useQuery({
    queryKey: ['products', 'opname'],
    queryFn: () => listWithPending('active', (s) => apiClient.get<Product[]>(`/products?status=${s}`)),
  });
  const selected = productsQuery.data?.find((p) => p.id === selectedId) ?? null;
  // Unit dipesan invoice masih ada di rak tetapi tidak termasuk stok tersedia.
  const reservedQuery = useQuery({
    queryKey: ['product-reserved', selectedId],
    queryFn: () => apiClient.get<unknown[]>(`/products/${selectedId}/units?status=reserved`),
    enabled: !!selectedId,
  });
  const reserved = reservedQuery.data?.length ?? 0;

  const system = selected?.stock ?? 0;
  const physical = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  const less = physical !== null && physical < system;

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ removedUnits?: string[]; delta: number }[]>('/stock/opname', {
        items: [{ kind: 'product', refId: selected!.id, physicalQty: physical }],
      }),
    onSuccess: ([result]) => {
      setRemoved(result.removedUnits ?? []);
      setValue('');
      toast.success(
        result.delta === 0 ? 'Stok sudah sesuai, tidak ada perubahan.' : `Stok dikoreksi ${result.delta} unit.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan opname.'),
  });

  const q = search.trim().toLowerCase();
  const filtered = (productsQuery.data ?? []).filter((p) => p.name.toLowerCase().includes(q));

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[360px_1fr]">
      <Card panel>
        <CardHeader>
          <CardTitle className="text-base">1. Pilih produk AC</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-3">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Cari produk"
              placeholder="Cari nama produk..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {productsQuery.isLoading ? (
            <LoadingBlock label="Memuat data" className="py-6" />
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada produk.</p>
          ) : (
            <div className="grid max-h-[65vh] gap-1 overflow-y-auto">
              {filtered.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => {
                    setSelectedId(p.id);
                    setValue('');
                    setRemoved([]);
                  }}
                  className={`rounded-md px-2 py-2 text-left transition-colors hover:bg-accent ${selectedId === p.id ? 'bg-accent' : ''}`}
                >
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Stok {p.stock} unit</p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card panel>
        <CardHeader>
          <CardTitle className="text-base">{selected ? `2. Hitung fisik: ${selected.name}` : '2. Hitung fisik'}</CardTitle>
          {selected && <CardDescription>Ketik jumlah unit yang benar-benar ada di gudang.</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4">
          {!selected ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Pilih produk di sebelah kiri.</p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border p-3">
                <span className="text-sm text-muted-foreground">Tercatat tersedia</span>
                <span className="text-lg font-semibold">{system} unit</span>
              </div>
              {reserved > 0 && (
                <p className="rounded-md bg-amber-500/15 px-3 py-2 text-sm">
                  {reserved} unit sudah dipesan invoice. <strong>Jangan ikut dihitung.</strong>
                </p>
              )}
              <label className="grid gap-1.5 text-sm font-medium">
                Jumlah yang benar (unit)
                <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
              </label>
              {physical !== null && physical > system && (
                <p className="text-sm text-destructive">
                  Lebih banyak dari catatan. Masukkan unit tambahan lewat Barang Masuk supaya mendapat QR.
                </p>
              )}
              {less && (
                <p role="status" className="rounded-md bg-amber-500/15 px-3 py-2 text-sm">
                  {system - physical} unit yang paling baru masuk akan dihapus dari stok.
                </p>
              )}
              <Button disabled={!less || mutation.isPending} onClick={() => setConfirming(true)}>
                {mutation.isPending ? 'Menyimpan...' : 'Koreksi stok'}
              </Button>
              {removed.length > 0 && (
                <div role="status" className="rounded-md border border-destructive/40 p-3 text-sm">
                  <p className="font-medium">Cabut label unit berikut:</p>
                  <ul className="mt-1 list-inside list-disc">
                    {removed.map((code) => (
                      <li key={code}>{code}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Kurangi stok AC?"
        description={`${selected?.name}: stok dari ${system} menjadi ${physical} unit. ${system - (physical ?? 0)} unit yang paling baru masuk dihapus.`}
        confirmLabel="Ya, kurangi"
        destructive
        onConfirm={() => mutation.mutate()}
      />
    </div>
  );
}
