'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { requiredNumberField, optionalIntField, trimmedOrUndefined, numberOrUndefined } from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusFilterSelect, type MasterDataStatus } from '@/components/master-data/status-filter-select';
import { PaginationFooter, SearchBox, useListView } from '@/components/master-data/list-controls';
import { DeactivateDialog } from '@/components/master-data/deactivate-dialog';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Padanan model Service Prisma. `basePrice` Decimal -> string lewat JSON,
// `durationMinutes` Int biasa -> number. Jasa gak punya kolom stok sama
// sekali, jadi form-nya paling ringkas dari tiga master data ini.
interface ServiceItem {
  id: string;
  name: string;
  category: string | null;
  basePrice: string;
  durationMinutes: number | null;
  description: string | null;
  active: boolean;
}

const serviceSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  category: z.string().optional(),
  basePrice: requiredNumberField('Harga dasar wajib diisi'),
  durationMinutes: optionalIntField,
  description: z.string().optional(),
  active: z.boolean(),
});
type ServiceFormValues = z.infer<typeof serviceSchema>;

const emptyValues: ServiceFormValues = {
  name: '',
  category: '',
  basePrice: '',
  durationMinutes: '',
  description: '',
  active: true,
};

function toFormValues(s: ServiceItem): ServiceFormValues {
  return {
    name: s.name,
    category: s.category ?? '',
    basePrice: s.basePrice,
    durationMinutes: s.durationMinutes?.toString() ?? '',
    description: s.description ?? '',
    active: s.active,
  };
}

export default function JasaPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ServiceItem | null>(null);
  const [status, setStatus] = React.useState<MasterDataStatus>('active');
  const [deactivating, setDeactivating] = React.useState<ServiceItem | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['services', status],
    queryFn: () => apiClient.get<ServiceItem[]>(`/services?status=${status}`),
  });
  const view = useListView(data, (s) => [s.name, s.category, s.description].join(' '));

  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: emptyValues,
  });

  function openCreate() {
    setEditing(null);
    form.reset(emptyValues);
    setDialogOpen(true);
  }

  function openEdit(s: ServiceItem) {
    setEditing(s);
    form.reset(toFormValues(s));
    setDialogOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: ServiceFormValues) => {
      const base = {
        name: values.name.trim(),
        category: trimmedOrUndefined(values.category),
        basePrice: Number(values.basePrice),
        durationMinutes: numberOrUndefined(values.durationMinutes),
        description: trimmedOrUndefined(values.description),
      };
      if (editing) {
        return apiClient.patch<ServiceItem>(`/services/${editing.id}`, {
          ...base,
          active: values.active,
        });
      }
      return apiClient.post<ServiceItem>('/services', base);
    },
    onSuccess: () => {
      toast.success(editing ? 'Jasa diperbarui.' : 'Jasa ditambahkan.');
      queryClient.invalidateQueries({ queryKey: ['services'] });
      setDialogOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan jasa.');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (s: ServiceItem) =>
      apiClient.patch<ServiceItem>(`/services/${s.id}`, { active: !s.active }),
    onSuccess: (_data, s) => {
      toast.success(s.active ? 'Jasa dinonaktifkan.' : 'Jasa diaktifkan kembali.');
      queryClient.invalidateQueries({ queryKey: ['services'] });
      setDeactivating(null);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengubah status jasa.');
    },
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jasa</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Katalog jasa servis/instalasi beserta harga dasarnya.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusFilterSelect value={status} onChange={setStatus} />
          <Button onClick={openCreate}>
            <Plus />
            Tambah Jasa
          </Button>
        </div>
      </div>

      <SearchBox value={view.search} onChange={view.setSearch} placeholder="Cari nama, kategori, atau deskripsi..." />

      {isLoading && <p className="text-sm text-muted-foreground">Memuat jasa...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat data jasa.</p>}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <p className="text-sm text-muted-foreground">
          Belum ada jasa. Klik &ldquo;Tambah Jasa&rdquo; untuk mulai.
        </p>
      )}
      {!isLoading && !isError && data && data.length > 0 && view.total === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada jasa yang cocok dengan pencarian.</p>
      )}
      {!isLoading && !isError && data && data.length > 0 && view.total > 0 && (
        <>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Harga Dasar</TableHead>
                <TableHead>Durasi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.pageItems.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.category ?? '-'}</TableCell>
                  <TableCell>{formatRupiah(s.basePrice)}</TableCell>
                  <TableCell>
                    {s.durationMinutes ? `${s.durationMinutes} menit` : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.active ? 'success' : 'secondary'}>
                      {s.active ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(s)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={s.active ? 'Nonaktifkan' : 'Aktifkan kembali'}
                        onClick={() => setDeactivating(s)}
                      >
                        {s.active ? (
                          <Trash2 className="size-4 text-destructive" />
                        ) : (
                          <RotateCcw className="size-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PaginationFooter page={view.page} totalPages={view.totalPages} total={view.total} noun="jasa" onPage={view.setPage} />
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Jasa' : 'Tambah Jasa'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Ubah data jasa.' : 'Isi data jasa baru.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              className="grid gap-4"
              onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama</FormLabel>
                    <FormControl>
                      <Input placeholder="Contoh: Cuci AC Split" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kategori</FormLabel>
                      <FormControl>
                        <Input placeholder="Opsional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="durationMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Durasi (menit)</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="Opsional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="basePrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Harga Dasar</FormLabel>
                    <FormControl>
                      <CurrencyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deskripsi</FormLabel>
                    <FormControl>
                      <Textarea rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {editing && (
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="font-normal">
                        Jasa aktif (tampil di POS/servis)
                      </FormLabel>
                    </FormItem>
                  )}
                />
              )}
              <DialogFooter>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {deactivating && (
        <DeactivateDialog
          open={!!deactivating}
          onOpenChange={(open) => !open && setDeactivating(null)}
          itemName={deactivating.name}
          willActivate={!deactivating.active}
          onConfirm={() => toggleActiveMutation.mutate(deactivating)}
          isPending={toggleActiveMutation.isPending}
        />
      )}
    </div>
  );
}
