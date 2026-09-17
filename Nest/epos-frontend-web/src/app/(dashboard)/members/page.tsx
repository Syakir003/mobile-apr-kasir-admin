'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Setiap checkout POS/servis otomatis bikin (atau reuse) row Member lewat
// MembersService.findOrCreate — halaman ini nampilin daftar SEMUA member
// yang kebentuk dari situ. Detail per member (klik baris) ada di
// /members/[id], isinya riwayat pembelian (invoice) + unit AC yang dia
// punya; dari situ tiap unit AC bisa diklik lagi buat lihat riwayat
// servisnya (lihat /ac-units/[id]).
interface MemberRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  customerType: string | null;
  memberSince: string | null;
  active: boolean;
  _count: { acUnits: number; invoices: number };
}

export default function MembersPage() {
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['members', debounced],
    queryFn: () =>
      apiClient.get<MemberRow[]>(
        `/members${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`,
      ),
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Member</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Semua customer yang pernah checkout — otomatis kebentuk jadi member. Klik baris
          untuk lihat riwayat pembelian & unit AC-nya.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari nama atau nomor HP..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Memuat member...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat data member.</p>}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <p className="text-sm text-muted-foreground">
          {debounced ? 'Tidak ada member yang cocok.' : 'Belum ada member.'}
        </p>
      )}
      {!isLoading && !isError && data && data.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>No. HP</TableHead>
                <TableHead>Alamat</TableHead>
                <TableHead>Unit AC</TableHead>
                <TableHead>Transaksi</TableHead>
                <TableHead>Member Sejak</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((m) => (
                <TableRow
                  key={m.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/members/${m.id}`)}
                >
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="text-muted-foreground">{m.phone || '-'}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">
                    {m.address || '-'}
                  </TableCell>
                  <TableCell>{m._count.acUnits}</TableCell>
                  <TableCell>{m._count.invoices}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.memberSince ? formatDate(m.memberSince) : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.active ? 'success' : 'secondary'}>
                      {m.active ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
