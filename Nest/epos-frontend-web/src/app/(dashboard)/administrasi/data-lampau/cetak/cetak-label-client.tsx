'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { BarcodeQr } from '@/components/barcode-qr';
import { Button } from '@/components/ui/button';

interface LabelUnit {
  id: string;
  barcodeValue: string;
  status: string;
  brand: string | null;
  model: string | null;
  pk: number | null;
  roomLocation: string | null;
  indoorProduct?: { name: string } | null;
  outdoorProduct?: { name: string } | null;
  member: { id: string; name: string; phone: string | null; address: string | null };
}

// Lembar stiker A4, 2 kolom. Setiap label SELALU memuat nama member +
// alamat + ruangan supaya tim yang keliling tahu tujuannya tanpa buka sistem.
// Unit 'menunggu_data' diberi tanda "TIPE BELUM DIKETAHUI" — teknisi
// melengkapi datanya saat scan di lokasi.
export function CetakLabelClient({ ids }: { ids: string }) {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['unit-labels', 'data', ids],
    queryFn: () => apiClient.get<LabelUnit[]>(`/unit-labels/data?ids=${encodeURIComponent(ids)}`),
    enabled: !!ids,
  });
  const markPrinted = useMutation({
    mutationFn: (list: string[]) => apiClient.post('/unit-labels/mark-printed', { ids: list }),
  });

  if (!ids) return <p className="p-6 text-sm text-muted-foreground">Tidak ada unit yang dipilih.</p>;
  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat label...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat label.</p>;

  function handlePrint() {
    window.print();
    markPrinted.mutate(data!.map((u) => u.id));
  }

  return (
    <div>
      <style>{'@page { size: A4; margin: 8mm; }'}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <Button onClick={handlePrint}>
          <Printer className="size-4" />
          Cetak {data.length} Label
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-white text-black">
        {data.map((u) => {
          const tipe = [u.brand, u.model].filter(Boolean).join(' ');
          return (
            <div
              key={u.id}
              className="flex h-[62mm] items-center gap-3 border border-dashed border-neutral-400 p-3"
              style={{ breakInside: 'avoid' }}
            >
              <div className="flex flex-col items-center gap-1">
                <BarcodeQr value={u.barcodeValue} size={96} />
                <p className="text-[9px] leading-none">{u.barcodeValue}</p>
              </div>
              <div className="min-w-0 flex-1 text-xs leading-snug">
                <p className="text-[10px] font-bold uppercase tracking-wide">AYUB AC</p>
                <p className="text-sm font-bold">{u.member.name}</p>
                <p className="mt-0.5 line-clamp-3">{u.member.address || '-'}</p>
                {u.roomLocation && <p className="mt-0.5 font-medium">Ruang: {u.roomLocation}</p>}
                {u.status === 'menunggu_data' ? (
                  <p className="mt-1 inline-block border border-black px-1 text-[10px] font-bold">
                    TIPE BELUM DIKETAHUI
                  </p>
                ) : (
                  <p className="mt-0.5">
                    {tipe || '-'}
                    {u.pk != null ? ` · ${u.pk} PK` : ''}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
