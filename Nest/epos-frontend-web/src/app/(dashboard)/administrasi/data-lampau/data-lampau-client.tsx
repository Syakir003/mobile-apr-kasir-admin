'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InputTab } from './input-tab';
import { LabelTab } from './label-tab';
import { KoreksiTab } from './koreksi-tab';

// Halaman "Input Data Lampau" (Administrasi, admin-only) — menggantikan
// "Input Transaksi Manual". Tiga tab: Input (member + unit AC + transaksi
// opsional), Label QR (tracking cetak/tempel), Koreksi (usulan teknisi).
// Spec: specs/2026-10-01-input-data-lampau-design.md
export function DataLampauClient() {
  const [tab, setTab] = React.useState('input');
  const pending = useQuery({
    queryKey: ['unit-corrections', 'pending-count'],
    queryFn: () => apiClient.get<{ pendingCount: number }>('/unit-corrections?status=pending&pageSize=1'),
    refetchInterval: 60_000,
  });
  const pendingCount = pending.data?.pendingCount ?? 0;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Input Data Lampau</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Daftarkan customer lama beserta unit AC-nya, cetak QR untuk ditempel di lokasi, dan
          setujui koreksi data dari teknisi. Transaksi lampau bersifat opsional dan tidak
          memotong stok.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="input">Input</TabsTrigger>
          <TabsTrigger value="label">Label QR</TabsTrigger>
          <TabsTrigger value="koreksi">
            Koreksi Data
            {pendingCount > 0 && (
              <Badge variant="warning" className="ml-2">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="input" className="mt-4">
          <InputTab onGoLabel={() => setTab('label')} />
        </TabsContent>
        <TabsContent value="label" className="mt-4">
          <LabelTab />
        </TabsContent>
        <TabsContent value="koreksi" className="mt-4">
          <KoreksiTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
