'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Save, Search, Trash2, X } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import {
  requiredNumberField,
  optionalNumberField,
  trimmedOrUndefined,
  numberOrUndefined,
} from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

// Fitur "Input Transaksi Manual" (admin) — BUKAN checkout POS. Tujuannya
// migrasi data histori: transaksi & member yang udah ada dari sebelum
// sistem ini jalan (lihat komentar InvoicesService.createManual di
// backend). Halaman ini cuma bisa diakses admin — dijaga di proxy.ts
// (prefix '/invoices/manual') DAN backend (@Roles('admin') di endpoint
// POST /invoices/manual), dua-duanya independen.

interface MemberSearchResult {
  id: string;
  name: string;
  phone: string | null;
}

const itemSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  unit: z.string().optional(),
  qty: requiredNumberField('Qty wajib diisi'),
  unitPrice: requiredNumberField('Harga wajib diisi'),
  discount: optionalNumberField,
  buyPrice: optionalNumberField,
});

const formSchema = z.object({
  date: z.string().min(1, 'Tanggal wajib diisi'),
  newMemberName: z.string().optional(),
  newMemberPhone: z.string().optional(),
  newMemberAddress: z.string().optional(),
  items: z.array(itemSchema).min(1, 'Minimal 1 baris item'),
  discount: optionalNumberField,
  transportFee: optionalNumberField,
  totalPaid: optionalNumberField,
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

const emptyItem = { name: '', unit: 'pcs', qty: '1', unitPrice: '', discount: '', buyPrice: '' };
const emptyValues: FormValues = {
  date: '',
  newMemberName: '',
  newMemberPhone: '',
  newMemberAddress: '',
  items: [emptyItem],
  discount: '',
  transportFee: '',
  totalPaid: '',
  notes: '',
};

function computeSubtotal(items: FormValues['items']): number {
  return items.reduce((sum, it) => {
    const qty = Number(it.qty) || 0;
    const price = Number(it.unitPrice) || 0;
    const disc = Number(it.discount) || 0;
    return sum + Math.round(qty * price) - disc;
  }, 0);
}

export default function ManualInvoicePage() {
  const router = useRouter();
  const [memberTab, setMemberTab] = React.useState<'existing' | 'baru'>('existing');
  const [query, setQuery] = React.useState('');
  const [selectedMember, setSelectedMember] = React.useState<MemberSearchResult | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });

  const searchQuery = useQuery({
    queryKey: ['members-search', query],
    queryFn: () => apiClient.get<MemberSearchResult[]>(`/members/search?q=${encodeURIComponent(query)}`),
    enabled: memberTab === 'existing' && query.trim().length >= 2,
  });

  const items = form.watch('items');
  const subtotal = computeSubtotal(items);
  const discount = Number(form.watch('discount')) || 0;
  const transportFee = Number(form.watch('transportFee')) || 0;
  const grandTotal = Math.max(0, subtotal - discount) + transportFee;

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => apiClient.post<{ id: string }>('/invoices/manual', payload),
    onSuccess: (invoice) => {
      toast.success('Transaksi manual berhasil disimpan.');
      router.push(`/invoices/${invoice.id}`);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan transaksi manual.');
    },
  });

  function onSubmit(values: FormValues) {
    if (memberTab === 'existing' && !selectedMember) {
      toast.error('Pilih member dulu, atau pindah ke tab "Member Baru".');
      return;
    }
    if (memberTab === 'baru' && !trimmedOrUndefined(values.newMemberName)) {
      toast.error('Nama member baru wajib diisi.');
      return;
    }
    if (memberTab === 'baru' && !trimmedOrUndefined(values.newMemberPhone)) {
      toast.error('No. HP member baru wajib diisi.');
      return;
    }

    createMutation.mutate({
      date: values.date,
      memberId: memberTab === 'existing' ? selectedMember!.id : undefined,
      newMember:
        memberTab === 'baru'
          ? {
              name: values.newMemberName!.trim(),
              phone: values.newMemberPhone!.trim(),
              address: trimmedOrUndefined(values.newMemberAddress),
            }
          : undefined,
      items: values.items.map((it) => ({
        name: it.name.trim(),
        unit: trimmedOrUndefined(it.unit),
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        discount: numberOrUndefined(it.discount),
        buyPrice: numberOrUndefined(it.buyPrice),
      })),
      discount: numberOrUndefined(values.discount),
      transportFee: numberOrUndefined(values.transportFee),
      totalPaid: numberOrUndefined(values.totalPaid),
      notes: trimmedOrUndefined(values.notes),
    });
  }

  return (
    <div className="grid gap-6">
      <div>
        <Button variant="ghost" className="mb-2" onClick={() => router.push('/invoices')}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Input Transaksi Manual</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buat catatan transaksi & member dari data lama (sebelum sistem ini dipakai). Transaksi
          ini TIDAK memotong stok barang saat ini — murni catatan histori buat laporan & riwayat
          member.
        </p>
      </div>

      <Form {...form}>
        <form className="grid gap-6" onSubmit={form.handleSubmit(onSubmit)}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pelanggan &amp; Tanggal</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="max-w-xs">
                    <FormLabel>Tanggal Transaksi Asli</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={memberTab === 'existing' ? 'default' : 'outline'}
                  onClick={() => setMemberTab('existing')}
                >
                  Member Sudah Ada
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={memberTab === 'baru' ? 'default' : 'outline'}
                  onClick={() => setMemberTab('baru')}
                >
                  Member Baru
                </Button>
              </div>

              {memberTab === 'existing' &&
                (selectedMember ? (
                  <div className="flex items-center justify-between rounded-md border p-2">
                    <span className="text-sm">
                      <span className="font-medium">{selectedMember.name}</span>
                      {selectedMember.phone && (
                        <span className="text-muted-foreground"> — {selectedMember.phone}</span>
                      )}
                    </span>
                    <button type="button" onClick={() => setSelectedMember(null)}>
                      <X className="size-4 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <div className="relative max-w-sm">
                    <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Cari nama/nomor HP member..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query.trim().length >= 2 && (
                      <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
                        {searchQuery.isLoading && (
                          <p className="p-2 text-sm text-muted-foreground">Mencari...</p>
                        )}
                        {searchQuery.data?.length === 0 && (
                          <p className="p-2 text-sm text-muted-foreground">Tidak ditemukan.</p>
                        )}
                        {searchQuery.data?.map((m) => (
                          <button
                            type="button"
                            key={m.id}
                            className="flex w-full flex-col items-start px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              setSelectedMember(m);
                              setQuery('');
                            }}
                          >
                            <span className="font-medium">{m.name}</span>
                            {m.phone && (
                              <span className="text-xs text-muted-foreground">{m.phone}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

              {memberTab === 'baru' && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="newMemberName"
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
                    control={form.control}
                    name="newMemberPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>No. HP</FormLabel>
                        <FormControl>
                          <Input placeholder="08xxxxxxxxxx" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="newMemberAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Alamat (opsional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Alamat" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Item Transaksi</CardTitle>
                <CardDescription>
                  Ketik bebas nama barang/jasa — gak perlu ada di master data (buat barang lama
                  yang mungkin udah gak dijual lagi sekarang).
                </CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => append(emptyItem)}>
                <Plus className="size-4" />
                Tambah Baris
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {form.formState.errors.items?.message && (
                <p className="text-sm text-destructive">{form.formState.errors.items.message}</p>
              )}
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
                  <div className="grid gap-2 sm:grid-cols-6">
                    <FormField
                      control={form.control}
                      name={`items.${index}.name`}
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>Nama Barang/Jasa</FormLabel>
                          <FormControl>
                            <Input placeholder="mis. AC Split 1PK + Pasang" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`items.${index}.qty`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Qty</FormLabel>
                          <FormControl>
                            <Input inputMode="numeric" {...field} />
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
                            <Input placeholder="pcs" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`items.${index}.unitPrice`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Harga Satuan</FormLabel>
                          <FormControl>
                            <CurrencyInput {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`items.${index}.discount`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Diskon Baris (opsional)</FormLabel>
                          <FormControl>
                            <CurrencyInput {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name={`items.${index}.buyPrice`}
                    render={({ field }) => (
                      <FormItem className="max-w-xs">
                        <FormLabel>Harga Beli / HPP (opsional)</FormLabel>
                        <FormControl>
                          <CurrencyInput {...field} />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Isi kalau inget, biar laporan laba-rugi ikut akurat buat baris ini —
                          kalau kosong dianggap HPP 0.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Diskon, Ongkir &amp; Pembayaran</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="discount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Diskon Total (opsional)</FormLabel>
                      <FormControl>
                        <CurrencyInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="transportFee"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ongkir (opsional)</FormLabel>
                      <FormControl>
                        <CurrencyInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="totalPaid"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Jumlah Dibayar</FormLabel>
                      <FormControl>
                        <CurrencyInput {...field} />
                      </FormControl>
                      <div className="flex gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => form.setValue('totalPaid', String(grandTotal))}
                        >
                          Lunas
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => form.setValue('totalPaid', '0')}
                        >
                          Belum Bayar
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Catatan (opsional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Catatan tambahan" rows={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatRupiah(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Diskon</span>
                  <span>-{formatRupiah(discount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ongkir</span>
                  <span>{formatRupiah(transportFee)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 font-medium">
                  <span>Total</span>
                  <span>{formatRupiah(grandTotal)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={createMutation.isPending}>
              <Save className="size-4" />
              {createMutation.isPending ? 'Menyimpan...' : 'Simpan Transaksi'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
