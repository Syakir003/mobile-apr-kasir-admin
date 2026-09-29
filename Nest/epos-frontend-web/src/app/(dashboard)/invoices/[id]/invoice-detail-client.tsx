'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { requiredNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { formatDateTime, formatRupiah, statusLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PrintMenu } from '@/components/print-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
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

// Halaman detail 1 invoice — padanan invoice_detail_screen.dart di app
// mobile. Fokus utamanya: nunjukin sisa tagihan & riwayat pembayaran, plus
// tombol "Catat Pembayaran" buat kasus DP dibayar bertahap (perusahaan beli
// borongan, DP dulu, sisanya nyusul beberapa hari kemudian). Pembayaran
// susulan itu DICATAT DI INVOICE INI JUGA (bukan bikin transaksi baru) lewat
// POST /invoices/:id/payments — makanya invoiceId di URL ini yang jadi kunci
// penghubung, bukan pencarian ulang nama/HP pelanggan.

const PAYMENT_METHODS = [
  { value: 'tunai', label: 'Tunai' },
  { value: 'transfer', label: 'Transfer Bank' },
  { value: 'qris', label: 'QRIS' },
  { value: 'ewallet', label: 'E-Wallet' },
  { value: 'debit', label: 'Debit' },
] as const;

const paymentSchema = z.object({
  method: z.enum(['tunai', 'transfer', 'qris', 'ewallet', 'debit']),
  amount: requiredNumberField('Nominal wajib diisi'),
  note: z.string().optional(),
});
type PaymentFormValues = z.infer<typeof paymentSchema>;

interface InvoiceItemRow {
  id: string;
  kind: string;
  name: string;
  unit: string | null;
  qty: string;
  unitPrice: string;
  lineTotal: string;
}
interface InvoiceAdjustmentRow {
  id: string;
  amount: string;
  reason: string;
  createdAt: string;
}
interface ManualPaymentRow {
  id: string;
  method: string;
  amount: string;
  note: string | null;
  createdAt: string;
}
interface InvoiceDetail {
  id: string;
  number: string;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  member: { id: string; name: string; phone: string | null } | null;
  subtotal: string;
  discount: string;
  taxPercent: string;
  taxAmount: string;
  transportFee: string;
  grandTotal: string;
  totalPaid: string;
  notes: string | null;
  createdAt: string;
  items: InvoiceItemRow[];
  adjustments: InvoiceAdjustmentRow[];
  manualPayments: ManualPaymentRow[];
  // Ada isinya cuma kalau invoice ini lahir dari servis/instalasi — dipakai
  // PrintMenu buat nentuin pilihan "Cetak Surat Jalan"/"Cetak Label Unit"
  // relevan atau enggak (sama field/pola kayak InvoiceRow di /invoices).
  serviceOrders: { id: string; _count: { serviceOrderUnits: number } }[];
}

function invoiceStatusVariant(status: string): 'success' | 'warning' | 'secondary' {
  if (status === 'lunas') return 'success';
  if (status === 'batal' || status === 'refund') return 'secondary';
  return 'warning';
}

function adjustmentLabel(reason: string): string {
  if (reason === 'diskon_manual') return 'Diskon Manual';
  if (reason === 'pengajuan_tambahan') return 'Pengajuan Sparepart Tambahan';
  return reason;
}

const methodLabel = (value: string) =>
  PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;

export function InvoiceDetailClient({ invoiceId }: { invoiceId: string }) {
  const queryClient = useQueryClient();
  const [payDialogOpen, setPayDialogOpen] = React.useState(false);
  const [waDialogOpen, setWaDialogOpen] = React.useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => apiClient.get<InvoiceDetail>(`/invoices/${invoiceId}`),
  });

  const sisa = data ? Number(data.grandTotal) - Number(data.totalPaid) : 0;
  const canPay = !!data && data.status !== 'lunas' && data.status !== 'batal';
  const waPhone = data?.customerPhone || data?.member?.phone || null;
  // Pembayaran PALING BARU — ditampilin di header ("Pembayaran: QRIS" ala
  // prototype "Invoice & Struk"). Kalau invoice dibayar bertahap (DP lalu
  // pelunasan), yang kebaca di header ya metode pelunasan terakhir.
  const latestPayment =
    data && data.manualPayments.length > 0
      ? [...data.manualPayments].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )[0]
      : null;

  // Siklus WA/Fonnte — tombol "Kirim WA" manual (keputusan user: bukan
  // otomatis pas checkout, kasir/admin yang mutusin kapan kirim). Backend
  // yang nyusun teks pesannya (nomor invoice, item, total) — lihat
  // InvoicesService.sendWhatsapp.
  const sendWaMutation = useMutation({
    mutationFn: () => apiClient.post(`/invoices/${invoiceId}/send-whatsapp`),
    onSuccess: () => {
      toast.success('Invoice terkirim lewat WhatsApp.');
      setWaDialogOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengirim WhatsApp.');
    },
  });

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { method: 'tunai', amount: '', note: '' },
  });
  const method = form.watch('method');
  const amountInput = Number(form.watch('amount') || 0);
  // Tunai: uang diterima boleh melebihi sisa (kembalian dihitung di sini),
  // tapi yang dikirim ke server dipas-in ke sisa. Non-tunai gak boleh
  // melebihi sisa sama sekali — sama persis logic PaymentFormSheet Flutter.
  const change = method === 'tunai' && amountInput > sisa ? amountInput - sisa : 0;

  const payMutation = useMutation({
    mutationFn: (values: PaymentFormValues) => {
      const input = Number(values.amount);
      const amount = values.method === 'tunai' && input > sisa ? sisa : input;
      return apiClient.post(`/invoices/${invoiceId}/payments`, {
        method: values.method,
        amount,
        note: trimmedOrUndefined(values.note),
      });
    },
    onSuccess: () => {
      toast.success('Pembayaran tercatat.');
      setPayDialogOpen(false);
      form.reset({ method: 'tunai', amount: '', note: '' });
      queryClient.invalidateQueries({ queryKey: ['invoices', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mencatat pembayaran.');
    },
  });

  function onSubmitPayment(values: PaymentFormValues) {
    const input = Number(values.amount);
    if (input <= 0) {
      form.setError('amount', { message: 'Nominal harus lebih dari 0' });
      return;
    }
    if (values.method !== 'tunai' && input > sisa) {
      form.setError('amount', { message: 'Melebihi sisa tagihan' });
      return;
    }
    payMutation.mutate(values);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Memuat invoice...</p>;
  if (isError || !data) {
    return <p className="text-sm text-destructive">Gagal memuat data invoice.</p>;
  }

  return (
    <div className="grid gap-6">
      <Link
        href="/invoices"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Kembali ke Riwayat Transaksi
      </Link>

      {/* Header status-first ala prototype "Invoice & Struk" — status,
          nomor invoice, total, dan metode pembayaran terakhir langsung
          kebaca tanpa scroll. Warna header pakai token sidebar (teal) yang
          sama dengan sidebar/dashboard, BUKAN warna baru. */}
      <Card className="overflow-hidden py-0">
        <div className="flex flex-wrap items-start justify-between gap-4 bg-sidebar px-6 py-5 text-sidebar-foreground">
          <div>
            <p className="text-sm text-sidebar-foreground/70">Invoice</p>
            <h1 className="text-2xl font-bold text-white">{data.number}</h1>
            <p className="mt-1 text-sm text-sidebar-foreground/70">
              {formatDateTime(data.createdAt)}
            </p>
          </div>
          <Badge variant={invoiceStatusVariant(data.status)} className="px-3 py-1 text-sm">
            {statusLabel(data.status)}
          </Badge>
        </div>
        <CardContent className="grid gap-1.5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Total Tagihan</span>
            <span className="text-2xl font-bold text-primary">
              {formatRupiah(data.grandTotal)}
            </span>
          </div>
          {latestPayment && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Pembayaran</span>
              <span className="font-medium">{methodLabel(latestPayment.method)}</span>
            </div>
          )}
          {sisa > 0 && data.status !== 'batal' && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sisa Tagihan</span>
              <span className="font-medium text-destructive">{formatRupiah(sisa)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="grid h-fit gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data Pelanggan</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <DetailRow
                label="Nama"
                value={
                  data.member ? (
                    <Link
                      href={`/members/${data.member.id}`}
                      className="font-medium hover:underline"
                    >
                      {data.customerName || data.member.name}
                    </Link>
                  ) : (
                    data.customerName || '-'
                  )
                }
              />
              <DetailRow label="No. HP" value={data.customerPhone || '-'} />
              <DetailRow label="Tanggal" value={formatDateTime(data.createdAt)} />
              {data.notes && <DetailRow label="Catatan" value={data.notes} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5 text-sm">
              <TotalRow label="Subtotal" value={formatRupiah(data.subtotal)} />
              {Number(data.discount) > 0 && (
                <TotalRow label="Diskon" value={`- ${formatRupiah(data.discount)}`} />
              )}
              {data.adjustments.map((adj) => (
                <TotalRow
                  key={adj.id}
                  label={adjustmentLabel(adj.reason)}
                  value={
                    Number(adj.amount) < 0
                      ? `- ${formatRupiah(Math.abs(Number(adj.amount)))}`
                      : formatRupiah(adj.amount)
                  }
                />
              ))}
              {Number(data.taxAmount) > 0 && (
                <TotalRow
                  label={`Pajak (${data.taxPercent}%)`}
                  value={formatRupiah(data.taxAmount)}
                />
              )}
              {Number(data.transportFee) > 0 && (
                <TotalRow label="Transport" value={formatRupiah(data.transportFee)} />
              )}
              <div className="my-1 border-t" />
              <TotalRow label="Total" value={formatRupiah(data.grandTotal)} bold />
              <TotalRow label="Dibayar" value={formatRupiah(data.totalPaid)} />
              <TotalRow label="Sisa" value={formatRupiah(sisa)} bold />
            </CardContent>
          </Card>

          {/* Aksi ditaruh DI BAWAH Ringkasan (bukan baris terpisah di atas
              kolom, dan bukan juga langsung nempel di header) — alurnya jadi
              baca dulu detail & totalnya, baru mutusin aksi apa, padanan
              baris "Kirim WA / Kirim Email / Cetak Struk" di prototype.
              "Kirim Email" SENGAJA gak diikutin: belum ada kemampuan kirim
              email di backend (beda kayak WA yang sudah ada integrasi
              Fonnte). "Cetak Struk" dipenuhi PrintMenu yang sudah ada. */}
          <div className="grid gap-2">
            {canPay && <Button onClick={() => setPayDialogOpen(true)}>Catat Pembayaran</Button>}
            {waPhone && (
              <Button variant="outline" onClick={() => setWaDialogOpen(true)}>
                <MessageCircle className="size-4" />
                Kirim WA
              </Button>
            )}
            <PrintMenu
              invoiceId={data.id}
              serviceOrders={data.serviceOrders}
              variant="outline"
              size="default"
              className="w-full"
            />
          </div>
        </div>

        <div className="grid h-fit gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Item</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {data.items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {trimZero(item.qty)} {item.unit || ''} × {formatRupiah(item.unitPrice)}
                    </p>
                  </div>
                  <p className="font-medium">{formatRupiah(item.lineTotal)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Riwayat Pembayaran</CardTitle>
            </CardHeader>
            <CardContent>
              {data.manualPayments.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada pembayaran.</p>
              )}
              {data.manualPayments.length > 0 && (
                <div className="grid gap-3">
                  {data.manualPayments.map((p) => (
                    <div key={p.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium">{methodLabel(p.method)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(p.createdAt)}
                          {p.note ? ` — ${p.note}` : ''}
                        </p>
                      </div>
                      <p className="font-medium">{formatRupiah(p.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Catat Pembayaran</DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Sisa tagihan</span>
            <span className="font-semibold">{formatRupiah(sisa)}</span>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitPayment)} className="grid gap-4">
              <FormField
                control={form.control}
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Metode</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {method === 'tunai' ? 'Uang Diterima (Rp)' : 'Nominal (Rp)'}
                    </FormLabel>
                    <FormControl>
                      <CurrencyInput {...field} />
                    </FormControl>
                    {change > 0 && (
                      <p className="text-sm font-medium text-emerald-600">
                        Kembalian: {formatRupiah(change)}
                      </p>
                    )}
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
                      <Input placeholder="Mis. transfer via BCA a.n. Budi" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit" disabled={payMutation.isPending}>
                  {payMutation.isPending ? 'Menyimpan...' : 'Simpan Pembayaran'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={waDialogOpen} onOpenChange={setWaDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kirim Invoice lewat WhatsApp</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Invoice {data.number} akan dikirim ke <span className="font-medium text-foreground">{waPhone}</span>.
          </p>
          <DialogFooter>
            <Button
              onClick={() => sendWaMutation.mutate()}
              disabled={sendWaMutation.isPending}
            >
              {sendWaMutation.isPending ? 'Mengirim...' : 'Kirim'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function TotalRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className={bold ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span className={bold ? 'font-semibold' : ''}>{value}</span>
    </div>
  );
}

function trimZero(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : v;
}
