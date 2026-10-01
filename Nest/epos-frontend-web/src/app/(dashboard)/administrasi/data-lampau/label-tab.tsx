'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCheck, Printer, Search } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface LabelRow {
  id: string;
  barcodeValue: string;
  status: string;
  brand: string | null;
  model: string | null;
  pk: number | null;
  roomLocation: string | null;
  indoorProduct?: { name: string } | null;
  outdoorProduct?: { name: string } | null;
  labelPrintedAt: string | null;
  labelAttachedAt: string | null;
  member: { id: string; name: string; phone: string | null; address: string | null };
}
interface LabelList {
  counts: { belumDicetak: number; belumDitempel: number; menungguData: number };
  items: LabelRow[];
  total: number;
  page: number;
  totalPages: number;
}

const LABEL_OPTS = [
  { v: 'belum_ditempel', t: 'Belum ditempel' },
  { v: 'belum_dicetak', t: 'Belum dicetak' },
  { v: 'sudah_ditempel', t: 'Sudah ditempel' },
  { v: 'semua', t: 'Semua' },
];
const DATA_OPTS = [
  { v: 'semua', t: 'Semua data' },
  { v: 'menunggu_data', t: 'Menunggu data teknisi' },
  { v: 'aktif', t: 'Data lengkap' },
];

export function LabelTab() {
  const router = useRouter();
  const qc = useQueryClient();
  const [label, setLabel] = React.useState('belum_ditempel');
  const [dataF, setDataF] = React.useState('semua');
  const [q, setQ] = React.useState('');
  const [term, setTerm] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  const { data, isFetching } = useQuery({
    queryKey: ['unit-labels', 'list', label, dataF, term, page],
    queryFn: () =>
      apiClient.get<LabelList>(
        `/unit-labels?label=${label}&data=${dataF}&page=${page}&pageSize=20${term ? `&q=${encodeURIComponent(term)}` : ''}`,
      ),
  });

  const attach = useMutation({
    mutationFn: (ids: string[]) => apiClient.post('/unit-labels/mark-attached', { ids }),
    onSuccess: () => {
      toast.success('Ditandai sudah ditempel.');
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ['unit-labels'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal menandai.'),
  });

  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((i) => picked.has(i.id));

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setPicked((s) => {
      const n = new Set(s);
      if (allOnPage) items.forEach((i) => n.delete(i.id));
      else items.forEach((i) => n.add(i.id));
      return n;
    });
  }
  function print() {
    const ids = [...picked].slice(0, 100);
    router.push(`/administrasi/data-lampau/cetak?ids=${encodeURIComponent(ids.join(','))}`);
  }

  return (
    <div className="grid gap-4">
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4"><p className="text-2xl font-semibold">{data.counts.belumDicetak}</p><p className="text-xs text-muted-foreground">Belum dicetak</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-2xl font-semibold">{data.counts.belumDitempel}</p><p className="text-xs text-muted-foreground">Belum ditempel</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-2xl font-semibold">{data.counts.menungguData}</p><p className="text-xs text-muted-foreground">Menunggu data teknisi</p></CardContent></Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q.trim());
            setPage(1);
          }}
        >
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Cari member / alamat / ruangan / kode" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <Select value={label} onValueChange={(v) => { setLabel(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{LABEL_OPTS.map((o) => <SelectItem key={o.v} value={o.v}>{o.t}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={dataF} onValueChange={(v) => { setDataF(v); setPage(1); }}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>{DATA_OPTS.map((o) => <SelectItem key={o.v} value={o.v}>{o.t}</SelectItem>)}</SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" disabled={picked.size === 0 || picked.size > 100} onClick={print}>
            <Printer className="size-4" /> Cetak ({picked.size})
          </Button>
          <Button size="sm" variant="outline" disabled={picked.size === 0 || attach.isPending} onClick={() => attach.mutate([...picked])}>
            <CheckCheck className="size-4" /> Tandai sudah ditempel
          </Button>
        </div>
      </div>
      {picked.size > 100 && <p className="text-sm text-destructive">Maksimal 100 label sekali cetak.</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={allOnPage} onCheckedChange={toggleAll} aria-label="Pilih semua di halaman" /></TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Label</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell><Checkbox checked={picked.has(u.id)} onCheckedChange={() => toggle(u.id)} aria-label={`Pilih ${u.barcodeValue}`} /></TableCell>
                  <TableCell>
                    <p className="font-medium">{u.member.name}</p>
                    <p className="max-w-xs truncate text-xs text-muted-foreground">{u.member.address || 'Alamat belum tercatat'}</p>
                  </TableCell>
                  <TableCell>
                    <p className="font-mono text-xs">{u.barcodeValue}</p>
                    <p className="text-sm">
                      {u.status === 'menunggu_data'
                        ? 'Tipe belum diketahui'
                        : [u.brand, u.model].filter(Boolean).join(' ') || u.indoorProduct?.name || '-'}
                      {u.roomLocation ? ` · ${u.roomLocation}` : ''}
                    </p>
                  </TableCell>
                  <TableCell>
                    {u.status === 'menunggu_data' ? <Badge variant="warning">Menunggu data</Badge> : <Badge variant="success">Lengkap</Badge>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {u.labelAttachedAt ? (
                      <Badge variant="success">Ditempel {formatDate(u.labelAttachedAt)}</Badge>
                    ) : u.labelPrintedAt ? (
                      <Badge variant="secondary">Dicetak {formatDate(u.labelPrintedAt)}</Badge>
                    ) : (
                      <Badge variant="outline">Belum dicetak</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    {isFetching ? 'Memuat...' : 'Tidak ada unit untuk filter ini.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Sebelumnya</Button>
          <span>{page} / {data.totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Berikutnya</Button>
        </div>
      )}
    </div>
  );
}
