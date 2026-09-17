'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Search, Ticket, X } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah, formatDate } from '@/lib/format';
import { requiredNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

// Padanan model `Voucher` Prisma (rework 2026-09 — bukan lagi
// VoucherCampaign+VoucherClaim). Satu baris = satu voucher ad-hoc, TERIKAT
// ke satu member sejak dibuat admin, dipakai kasir dengan ketik kodenya di
// field "Kode Voucher" saat checkout POS (lihat pos/page.tsx) — tidak ada
// langkah "klaim" atau "tawarkan" terpisah lagi.
interface VoucherMember {
  id: string;
  name: string;
  phone: string | null;
}
interface Voucher {
  id: string;
  code: string;
  memberId: string;
  member: VoucherMember;
  discountType: 'persen' | 'nominal';
  discountValue: string;
  maxDiscountCap: string | null;
  minPurchase: string | null;
  expiresAt: string;
  status: 'aktif' | 'terpakai' | 'kadaluarsa' | 'dibatalkan';
  source: 'undian' | 'manual';
  note: string | null;
  createdAt: string;
}

// Hasil GET /members/search — sama pola yang dipakai POS buat "pilih member
// yang udah ada" (lihat komentar di pos/page.tsx), di sini dipakai buat
// milih pelanggan yang mau dibuatin voucher.
interface MemberSearchResult {
  id: string;
  name: string;
  phone: string | null;
}

function discountLabel(v: Pick<Voucher, 'discountType' | 'discountValue'>): string {
  return v.discountType === 'persen' ? `${Number(v.discountValue)}%` : formatRupiah(v.discountValue);
}

function statusVariant(status: Voucher['status']): 'success' | 'secondary' | 'destructive' {
  if (status === 'aktif') return 'success';
  if (status === 'terpakai') return 'secondary';
  return 'destructive';
}

const statusLabel: Record<Voucher['status'], string> = {
  aktif: 'Aktif',
  terpakai: 'Terpakai',
  kadaluarsa: 'Kadaluarsa',
  dibatalkan: 'Dibatalkan',
};

const voucherSchema = z
  .object({
    discountType: z.enum(['persen', 'nominal']),
    discountValue: requiredNumberField('Nilai diskon wajib diisi'),
    maxDiscountCap: z.string().optional(),
    minPurchase: z.string().optional(),
    expiresAt: z.string().min(1, 'Wajib diisi'),
    note: z.string().optional(),
  })
  .refine((v) => v.discountType !== 'persen' || Number(v.discountValue) <= 100, {
    message: 'Diskon persen maksimal 100',
    path: ['discountValue'],
  });
type VoucherFormValues = z.infer<typeof voucherSchema>;

const emptyValues: VoucherFormValues = {
  discountType: 'nominal',
  discountValue: '',
  maxDiscountCap: '',
  minPurchase: '',
  expiresAt: '',
  note: '',
};

export default function VoucherPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [cancelTarget, setCancelTarget] = React.useState<Voucher | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['vouchers'],
    queryFn: () => apiClient.get<Voucher[]>('/vouchers'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/vouchers/${id}/cancel`, {}),
    onSuccess: () => {
      toast.success('Voucher dibatalkan.');
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      setCancelTarget(null);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal membatalkan voucher.');
    },
  });

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voucher</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Voucher ad-hoc untuk satu pelanggan tertentu. Kasir memakainya dengan mengetik
            kodenya di field &ldquo;Kode Voucher&rdquo; saat checkout POS.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Buat Voucher
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Memuat voucher...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat data voucher.</p>}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <p className="text-sm text-muted-foreground">
          Belum ada voucher. Klik &ldquo;Buat Voucher&rdquo; untuk mulai.
        </p>
      )}
      {!isLoading && !isError && data && data.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Pelanggan</TableHead>
                <TableHead>Diskon</TableHead>
                <TableHead>Min. Belanja</TableHead>
                <TableHead>Berlaku Sampai</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono font-medium">{v.code}</TableCell>
                  <TableCell>
                    {v.member.name}
                    {v.member.phone && (
                      <span className="ml-2 text-xs text-muted-foreground">{v.member.phone}</span>
                    )}
                  </TableCell>
                  <TableCell>{discountLabel(v)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {v.minPurchase ? formatRupiah(v.minPurchase) : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(v.expiresAt)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(v.status)}>{statusLabel[v.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    {v.status === 'aktif' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Batalkan voucher"
                        onClick={() => setCancelTarget(v)}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateVoucherDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Batalkan voucher?</DialogTitle>
            <DialogDescription>
              Kode {cancelTarget?.code} tidak akan bisa dipakai lagi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Tidak
            </Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}
            >
              {cancelMutation.isPending ? 'Membatalkan...' : 'Batalkan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateVoucherDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = React.useState('');
  const [selectedMember, setSelectedMember] = React.useState<MemberSearchResult | null>(null);

  const form = useForm<VoucherFormValues>({
    resolver: zodResolver(voucherSchema),
    defaultValues: emptyValues,
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset(emptyValues);
    setQuery('');
    setSelectedMember(null);
  }, [open, form]);

  const searchQuery = useQuery({
    queryKey: ['members-search', query],
    queryFn: () => apiClient.get<MemberSearchResult[]>(`/members/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: (values: VoucherFormValues) =>
      apiClient.post<Voucher>('/vouchers', {
        memberId: selectedMember!.id,
        discountType: values.discountType,
        discountValue: Number(values.discountValue),
        maxDiscountCap:
          values.discountType === 'persen' && values.maxDiscountCap?.trim()
            ? Number(values.maxDiscountCap)
            : undefined,
        minPurchase: values.minPurchase?.trim() ? Number(values.minPurchase) : undefined,
        expiresAt: values.expiresAt,
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: (voucher) => {
      toast.success(`Voucher dibuat: ${voucher.code}`);
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal membuat voucher.');
    },
  });

  function onSubmit(values: VoucherFormValues) {
    if (!selectedMember) {
      toast.error('Pilih pelanggan dulu.');
      return;
    }
    createMutation.mutate(values);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat Voucher</DialogTitle>
          <DialogDescription>
            Voucher ad-hoc untuk satu pelanggan — pilih pelanggan, tipe+nilai diskon, syarat
            opsional, lalu tanggal kedaluwarsa.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <FormLabel>Pelanggan</FormLabel>
          {selectedMember ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{selectedMember.name}</span>
                {selectedMember.phone && (
                  <span className="ml-2 text-xs text-muted-foreground">{selectedMember.phone}</span>
                )}
              </span>
              <button type="button" onClick={() => setSelectedMember(null)}>
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Cari nama/nomor HP pelanggan..."
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
                      {m.phone && <span className="text-xs text-muted-foreground">{m.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="discountType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipe Diskon</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="nominal">Nominal (Rp)</SelectItem>
                        <SelectItem value="persen">Persen (%)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="discountValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Nilai {form.watch('discountType') === 'persen' ? '(%)' : '(Rp)'}
                    </FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {form.watch('discountType') === 'persen' && (
              <FormField
                control={form.control}
                name="maxDiscountCap"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maks. Potongan (Rp, opsional)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="Kosongkan bila tidak dibatasi" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="minPurchase"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Minimal Belanja (Rp, opsional)</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="Kosongkan bila tidak ada syarat" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="expiresAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Berlaku Sampai</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Catatan (opsional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Alasan pemberian / syarat tambahan" rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={createMutation.isPending}>
                <Ticket className="size-4" />
                {createMutation.isPending ? 'Menyimpan...' : 'Buat Voucher'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
