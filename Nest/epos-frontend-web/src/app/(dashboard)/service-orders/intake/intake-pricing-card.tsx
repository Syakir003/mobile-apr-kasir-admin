'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Cara tagih order + harga perkiraan jasa di depan (opsional). Harga perkiraan langsung membuat invoice sehingga teknisi
// bisa melihatnya dan menagih di lokasi; admin boleh mengubahnya lagi dari halaman job.

export type PaymentMode = 'bayar_di_lokasi' | 'ditagih_admin';

/**
 * Bawaan form. SENGAJA 'ditagih_admin' (perilaku sebelum fitur pembayaran lapangan): order "bayar di lokasi" butuh pembayaran
 * tercatat sebelum teknisi bisa Ajukan Selesai, sedangkan app Flutter teknisi yang lama belum punya layar pembayaran. Ganti
 * ke 'bayar_di_lokasi' setelah aplikasi mobile mendukungnya.
 */
export const DEFAULT_PAYMENT_MODE: PaymentMode = 'ditagih_admin';

const TRANSPORT_STEP = 100000;

interface DraftLine {
  key: number;
  serviceId: string; // '' = jasa lain (ketik nama)
  name: string;
  qty: string;
  unitPrice: string;
}
export interface PricingDraft {
  lines: DraftLine[];
  transportLevel: number;
  transportMode: 'individu' | 'dibagi';
}
export const EMPTY_PRICING: PricingDraft = { lines: [], transportLevel: 0, transportMode: 'individu' };

interface CatalogService {
  id: string;
  name: string;
  basePrice: string;
}

const lineStarted = (l: DraftLine) => !!(l.serviceId || l.name.trim() || l.unitPrice);
const lineTotal = (l: DraftLine) => Math.round((Number(l.qty) || 0) * (Number(l.unitPrice) || 0));

/** Pesan galat bila ada baris harga yang sudah diisi tetapi belum lengkap; null = aman dikirim. */
export function pricingProblem(d: PricingDraft): string | null {
  const started = d.lines.filter(lineStarted);
  for (const l of started) {
    if (!l.serviceId && !l.name.trim()) return 'Nama jasa pada harga perkiraan belum diisi.';
    if (!(Number(l.qty) > 0)) return 'Jumlah jasa pada harga perkiraan harus lebih dari 0.';
    if (l.unitPrice === '' || !(Number(l.unitPrice) >= 0)) return 'Harga jasa pada harga perkiraan belum diisi.';
  }
  if (started.length === 0 && d.transportLevel > 0) return 'Transport hanya bisa diisi bersama baris jasa.';
  return null;
}

/** Bagian body POST /service-orders/intake untuk harga perkiraan; objek kosong bila tidak ada baris jasa. */
export function pricingPayload(d: PricingDraft): Record<string, unknown> {
  const started = d.lines.filter(lineStarted);
  if (started.length === 0) return {};
  return {
    serviceLines: started.map((l) => ({
      ...(l.serviceId ? { serviceId: l.serviceId } : {}),
      ...(l.name.trim() ? { name: l.name.trim() } : {}),
      qty: Number(l.qty),
      unitPrice: Number(l.unitPrice),
    })),
    ...(d.transportLevel > 0 ? { transportLevel: d.transportLevel, transportMode: d.transportMode } : {}),
  };
}

export function IntakePricingCard({
  paymentMode,
  onPaymentModeChange,
  value,
  onChange,
}: {
  paymentMode: PaymentMode;
  onPaymentModeChange: (mode: PaymentMode) => void;
  value: PricingDraft;
  onChange: (next: PricingDraft) => void;
}) {
  const servicesQuery = useQuery({
    queryKey: ['services', 'active'],
    queryFn: () => apiClient.get<CatalogService[]>('/services?status=active'),
  });
  const keySeq = React.useRef(1);
  const services = servicesQuery.data ?? [];

  const setLine = (key: number, patch: Partial<DraftLine>) =>
    onChange({ ...value, lines: value.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const addLine = () =>
    onChange({ ...value, lines: [...value.lines, { key: keySeq.current++, serviceId: '', name: '', qty: '1', unitPrice: '' }] });
  const pick = (key: number, serviceId: string) => {
    if (serviceId === '__free__') return setLine(key, { serviceId: '', name: '', unitPrice: '' });
    const svc = services.find((s) => s.id === serviceId);
    if (svc) setLine(key, { serviceId: svc.id, name: svc.name, unitPrice: String(Number(svc.basePrice)) });
  };

  const jasa = value.lines.filter(lineStarted).reduce((s, l) => s + lineTotal(l), 0);
  const transport = value.transportLevel * TRANSPORT_STEP;
  const hasLines = value.lines.some(lineStarted);

  return (
    <Card panel>
      <CardHeader>
        <CardTitle className="text-base">Harga &amp; Cara Tagih</CardTitle>
        <CardDescription>
          Opsional. Isi harga perkiraan supaya teknisi melihatnya dan bisa menagih di lokasi. Boleh dikosongkan dan
          ditetapkan nanti dari halaman job.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="intake-pay-mode">Cara tagih</Label>
          <Select value={paymentMode} onValueChange={(v) => onPaymentModeChange(v as PaymentMode)}>
            <SelectTrigger id="intake-pay-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ditagih_admin">Ditagih admin (instansi/langganan)</SelectItem>
              <SelectItem value="bayar_di_lokasi">Bayar di lokasi (teknisi menagih)</SelectItem>
            </SelectContent>
          </Select>
          {paymentMode === 'bayar_di_lokasi' && (
            <p className="text-xs text-muted-foreground">
              Teknisi mencatat pembayaran + foto bukti dan memberi Tanda Terima; sebelum Ajukan Selesai pembayaran harus
              tercatat atau ada alasan. Uang lunas setelah admin memverifikasi setoran. Butuh aplikasi teknisi yang
              mendukung pembayaran lapangan.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label>Harga perkiraan jasa</Label>
          {value.lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1.4fr)_5rem_minmax(0,1fr)_auto] sm:items-start">
              <div className="col-span-3 grid gap-1.5 sm:col-span-1">
                <Select value={l.serviceId || '__free__'} onValueChange={(v) => pick(l.key, v)}>
                  <SelectTrigger className="w-full" aria-label="Pilih jasa">
                    <SelectValue placeholder="Pilih jasa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__free__">Jasa lain (ketik nama)</SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} - {formatRupiah(Number(s.basePrice))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!l.serviceId && (
                  <Input
                    value={l.name}
                    onChange={(e) => setLine(l.key, { name: e.target.value })}
                    placeholder="Nama jasa"
                    maxLength={120}
                    aria-label="Nama jasa"
                  />
                )}
              </div>
              <Input
                inputMode="decimal"
                value={l.qty}
                onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/[^\d.]/g, '') })}
                aria-label="Jumlah"
              />
              <CurrencyInput value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v })} aria-label="Harga satuan" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Hapus baris"
                onClick={() => onChange({ ...value, lines: value.lines.filter((x) => x.key !== l.key) })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="size-4" />
              Tambah jasa
            </Button>
          </div>
        </div>

        {hasLines && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="intake-transport">Transport</Label>
              <Select
                value={String(value.transportLevel)}
                onValueChange={(v) => onChange({ ...value, transportLevel: Number(v) })}
              >
                <SelectTrigger id="intake-transport" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Tanpa transport</SelectItem>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Transport {n} - {formatRupiah(n * TRANSPORT_STEP)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {value.transportLevel > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="intake-transport-mode">Penulisan transport</Label>
                <Select
                  value={value.transportMode}
                  onValueChange={(v) => onChange({ ...value, transportMode: v as 'individu' | 'dibagi' })}
                >
                  <SelectTrigger id="intake-transport-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individu">Baris sendiri</SelectItem>
                    <SelectItem value="dibagi">Dibagi rata ke jasa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {hasLines && (
          <p className="text-sm text-muted-foreground">
            Perkiraan total: <span className="font-semibold text-foreground">{formatRupiah(jasa + transport)}</span>
            {' '}(sparepart yang disetujui nanti ditambahkan otomatis)
          </p>
        )}
      </CardContent>
    </Card>
  );
}
