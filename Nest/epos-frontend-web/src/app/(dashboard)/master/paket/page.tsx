'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import {
  requiredNumberField,
  optionalNumberField,
  trimmedOrUndefined,
  numberOrUndefined,
} from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

// Padanan model InstallationPackage(+Item) Prisma. `qty`/`extraPricePerUnit`
// DECIMAL -> string lewat JSON, sama kayak Sparepart/Product.
interface Sparepart {
  id: string;
  name: string;
  unit: string;
}
interface PackageItem {
  id?: string;
  sparepartId: string | null;
  name: string;
  qty: string;
  unit: string;
  extraPricePerUnit: string;
}
interface InstallationPackage {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  items: PackageItem[];
}

const itemSchema = z.object({
  // '' = gak nempel ke sparepart tertentu (item custom, mis. jasa tambahan).
  sparepartId: z.string().optional(),
  name: z.string().min(1, 'Wajib diisi'),
  qty: requiredNumberField('Qty wajib diisi'),
  unit: z.string().min(1, 'Wajib diisi'),
  extraPricePerUnit: optionalNumberField,
});
const packageSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  description: z.string().optional(),
  active: z.boolean(),
  items: z.array(itemSchema).min(1, 'Paket harus punya minimal 1 item'),
});
type PackageFormValues = z.infer<typeof packageSchema>;

const emptyItem = { sparepartId: '', name: '', qty: '1', unit: 'pcs', extraPricePerUnit: '' };
const emptyValues: PackageFormValues = {
  name: '',
  description: '',
  active: true,
  items: [emptyItem],
};

function toFormValues(p: InstallationPackage): PackageFormValues {
  return {
    name: p.name,
    description: p.description ?? '',
    active: p.active,
    items: p.items.map((it) => ({
      sparepartId: it.sparepartId ?? '',
      name: it.name,
      qty: it.qty,
      unit: it.unit,
      extraPricePerUnit: it.extraPricePerUnit,
    })),
  };
}

export default function PaketInstalasiPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<InstallationPackage | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['installation-packages'],
    queryFn: () => apiClient.get<InstallationPackage[]>('/installation-packages'),
  });
  // Buat dropdown "nempel ke sparepart" per item — opsional, item paket
  // boleh juga custom (mis. "Jasa Bongkar Unit Lama") tanpa nempel sparepart.
  const spareparts = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });

  const form = useForm<PackageFormValues>({
    resolver: zodResolver(packageSchema),
    defaultValues: emptyValues,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });

  function openCreate() {
    setEditing(null);
    form.reset(emptyValues);
    setDialogOpen(true);
  }

  function openEdit(p: InstallationPackage) {
    setEditing(p);
    form.reset(toFormValues(p));
    setDialogOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: PackageFormValues) => {
      const payload = {
        name: values.name.trim(),
        description: trimmedOrUndefined(values.description),
        active: values.active,
        items: values.items.map((it) => ({
          sparepartId: trimmedOrUndefined(it.sparepartId),
          name: it.name.trim(),
          qty: Number(it.qty),
          unit: it.unit.trim(),
          extraPricePerUnit: numberOrUndefined(it.extraPricePerUnit) ?? 0,
        })),
      };
      if (editing) {
        return apiClient.patch<InstallationPackage>(
          `/installation-packages/${editing.id}`,
          payload,
        );
      }
      return apiClient.post<InstallationPackage>('/installation-packages', payload);
    },
    onSuccess: () => {
      toast.success(editing ? 'Paket diperbarui.' : 'Paket ditambahkan.');
      queryClient.invalidateQueries({ queryKey: ['installation-packages'] });
      setDialogOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan paket.');
    },
  });

  function onPickSparepart(index: number, sparepartId: string) {
    form.setValue(`items.${index}.sparepartId`, sparepartId === 'none' ? '' : sparepartId);
    if (sparepartId === 'none') return;
    const sp = spareparts.data?.find((s) => s.id === sparepartId);
    if (sp) {
      form.setValue(`items.${index}.name`, sp.name);
      form.setValue(`items.${index}.unit`, sp.unit);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Paket Instalasi</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bundel sparepart & biaya tambahan buat instalasi unit AC — dipakai pas transaksi
            pemasangan biar gak input item satu-satu tiap kali.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Tambah Paket
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Memuat paket instalasi...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat data paket instalasi.</p>}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <p className="text-sm text-muted-foreground">
          Belum ada paket instalasi. Klik &ldquo;Tambah Paket&rdquo; untuk mulai.
        </p>
      )}
      {!isLoading && !isError && data && data.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Paket</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead>Jumlah Item</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.description || '-'}
                  </TableCell>
                  <TableCell>{p.items.length} item</TableCell>
                  <TableCell>
                    <Badge variant={p.active ? 'success' : 'secondary'}>
                      {p.active ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(p)}>
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Paket Instalasi' : 'Tambah Paket Instalasi'}</DialogTitle>
            <DialogDescription>
              Isi item-item yang termasuk dalam paket ini. Item boleh nempel ke sparepart (stok
              ikut kepotong) atau custom (mis. jasa tambahan).
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
                    <FormLabel>Nama Paket</FormLabel>
                    <FormControl>
                      <Input placeholder="Contoh: Paket Instalasi Standar 1 PK" {...field} />
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
                      <Textarea placeholder="Opsional" rows={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Item Paket</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append(emptyItem)}
                  >
                    <Plus className="size-4" />
                    Tambah Item
                  </Button>
                </div>
                {form.formState.errors.items?.root && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.items.root.message}
                  </p>
                )}
                {form.formState.errors.items?.message && (
                  <p className="text-sm text-destructive">{form.formState.errors.items.message}</p>
                )}

                <div className="grid gap-3">
                  {fields.map((field, index) => (
                    <div key={field.id} className="grid gap-2 rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Item #{index + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={fields.length <= 1}
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>

                      <FormItem>
                        <FormLabel>Nempel Sparepart (opsional)</FormLabel>
                        <Select
                          value={form.watch(`items.${index}.sparepartId`) || 'none'}
                          onValueChange={(v) => onPickSparepart(index, v)}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">— Item custom (gak nempel) —</SelectItem>
                            {spareparts.data?.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>

                      <FormField
                        control={form.control}
                        name={`items.${index}.name`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nama Item</FormLabel>
                            <FormControl>
                              <Input placeholder="Contoh: Pipa AC 1/4 inch" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-3 gap-2">
                        <FormField
                          control={form.control}
                          name={`items.${index}.qty`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Qty</FormLabel>
                              <FormControl>
                                <Input inputMode="numeric" placeholder="0" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.unit`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Satuan</FormLabel>
                              <FormControl>
                                <Input placeholder="pcs, meter" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.extraPricePerUnit`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Harga Tambahan/Unit</FormLabel>
                              <FormControl>
                                <CurrencyInput {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="font-normal">
                      Paket aktif (tampil buat dipilih)
                    </FormLabel>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
