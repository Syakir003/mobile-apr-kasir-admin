'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Search } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

// Bentuk respons POST /members — HTTP 200 walaupun butuh konfirmasi (nomor
// HP udah kepake member lain), bukan error. Pola sama kayak POST /stock/in.
interface CreateMemberResult {
  status: 'ok' | 'confirm_required';
  member?: MemberRow;
  existingMember?: { id: string; name: string; phone: string | null };
}

const createMemberSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi'),
  phone: z.string().optional(),
  address: z.string().optional(),
  customerType: z.enum(['rumah', 'perusahaan', 'toko', '']).optional(),
});
type CreateMemberValues = z.infer<typeof createMemberSchema>;
const emptyCreateValues: CreateMemberValues = {
  name: '',
  phone: '',
  address: '',
  customerType: '',
};

export default function MembersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [pendingDuplicate, setPendingDuplicate] = React.useState<
    CreateMemberResult['existingMember'] | null
  >(null);

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

  const createForm = useForm<CreateMemberValues>({
    resolver: zodResolver(createMemberSchema),
    defaultValues: emptyCreateValues,
  });

  function openCreate() {
    createForm.reset(emptyCreateValues);
    setPendingDuplicate(null);
    setCreateOpen(true);
  }

  const createMutation = useMutation({
    mutationFn: (values: CreateMemberValues & { confirmOverride?: boolean }) =>
      apiClient.post<CreateMemberResult>('/members', {
        name: values.name.trim(),
        phone: values.phone?.trim() || undefined,
        address: values.address?.trim() || undefined,
        customerType: values.customerType || undefined,
        confirmOverride: values.confirmOverride,
      }),
    onSuccess: (result) => {
      if (result.status === 'confirm_required') {
        // Backend belum nyimpen apa-apa — nunggu kasir/admin milih "Tetap
        // Lanjut" (submit ulang dengan confirmOverride) atau "Ganti Nomor"
        // (balik ke form, nilai form tetap kepegang).
        setPendingDuplicate(result.existingMember ?? null);
        return;
      }
      toast.success('Member ditambahkan.');
      setPendingDuplicate(null);
      setCreateOpen(false);
      createForm.reset(emptyCreateValues);
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menambahkan member.');
    },
  });

  function confirmDuplicateAndCreate() {
    createMutation.mutate({ ...createForm.getValues(), confirmOverride: true });
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Member</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Otomatis kebentuk dari checkout, atau daftarin manual lewat tombol di samping. Klik
            baris untuk lihat riwayat pembelian & unit AC-nya.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Tambah Member
        </Button>
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

      {/* Tambah Member */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Member</DialogTitle>
            <DialogDescription>
              Daftarin pelanggan manual — gak perlu nunggu dia checkout dulu.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form
              className="grid gap-4"
              onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
            >
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama</FormLabel>
                    <FormControl>
                      <Input placeholder="Nama pelanggan" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>No. HP</FormLabel>
                    <FormControl>
                      <Input placeholder="08xxxxxxxxxx (opsional)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alamat</FormLabel>
                    <FormControl>
                      <Input placeholder="Opsional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="customerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipe Customer</FormLabel>
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Opsional" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="rumah">Rumah</SelectItem>
                        <SelectItem value="perusahaan">Perusahaan</SelectItem>
                        <SelectItem value="toko">Toko</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Konfirmasi nomor HP dobel — backend belum nyimpen apa-apa selama
          dialog ini kebuka, form Tambah Member di belakangnya tetap ada. */}
      <Dialog
        open={!!pendingDuplicate}
        onOpenChange={(open) => !open && setPendingDuplicate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nomor HP sudah dipakai</DialogTitle>
            <DialogDescription>
              {pendingDuplicate
                ? `Nomor ini udah kepake member "${pendingDuplicate.name}". Tetap lanjut bikin member baru dengan nomor yang sama, atau ganti nomornya dulu?`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDuplicate(null)}
              disabled={createMutation.isPending}
            >
              Ganti Nomor
            </Button>
            <Button
              type="button"
              onClick={confirmDuplicateAndCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Menyimpan...' : 'Tetap Lanjut'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
