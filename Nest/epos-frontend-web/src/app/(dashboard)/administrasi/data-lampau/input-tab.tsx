'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Printer, QrCode, Save, Search, Trash2, X } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { intervalError } from '@/components/reminder-schedule-fields';

interface MemberHit {
  id: string;
  name: string;
  phone: string | null;
  address?: string | null;
}
interface ProductOpt {
  id: string;
  name: string;
  brand: string | null;
  acRole: string | null;
}
type Mode = 'diketahui' | 'qr_dulu';
type Source = 'bebas' | 'master';

interface UnitRow {
  key: number;
  mode: Mode;
  source: Source;
  roomLocation: string;
  brand: string;
  model: string;
  pk: string;
  serialNumber: string;
  installationDate: string;
  indoorProductId: string;
  outdoorProductId: string;
  lastServiceDate: string;
  serviceIntervalDays: string;
}
interface ItemRow {
  key: number;
  name: string;
  qty: string;
  unitPrice: string;
}
interface ImportResult {
  member: { id: string; name: string; address: string | null };
  memberIsNew: boolean;
  units: { id: string; barcodeValue: string; status: string; brand: string | null; model: string | null; roomLocation: string | null }[];
  invoice: { id: string; number: string } | null;
}

let seq = 0;
const newUnit = (mode: Mode = 'diketahui'): UnitRow => ({
  key: ++seq, mode, source: 'bebas', roomLocation: '', brand: '', model: '', pk: '', serialNumber: '',
  installationDate: '', indoorProductId: '', outdoorProductId: '', lastServiceDate: '', serviceIntervalDays: '',
});
const newItem = (): ItemRow => ({ key: ++seq, name: '', qty: '1', unitPrice: '' });

const NONE = '__none__';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function InputTab({ onGoLabel }: { onGoLabel: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();

  // ---- Member
  const [memberMode, setMemberMode] = React.useState<'existing' | 'baru'>('baru');
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<MemberHit | null>(null);
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [address, setAddress] = React.useState('');

  // ---- Unit & transaksi
  const [units, setUnits] = React.useState<UnitRow[]>([newUnit()]);
  const [withInvoice, setWithInvoice] = React.useState(false);
  const [invDate, setInvDate] = React.useState('');
  const [items, setItems] = React.useState<ItemRow[]>([newItem()]);
  const [invDiscount, setInvDiscount] = React.useState('');
  const [invPaid, setInvPaid] = React.useState('');
  const [invNotes, setInvNotes] = React.useState('');

  const [result, setResult] = React.useState<ImportResult | null>(null);

  const search = useQuery({
    queryKey: ['members-search', query],
    queryFn: () => apiClient.get<MemberHit[]>(`/members/search?q=${encodeURIComponent(query)}`),
    enabled: memberMode === 'existing' && query.trim().length >= 2,
  });
  const products = useQuery({
    queryKey: ['products', 'aktif'],
    queryFn: () => apiClient.get<ProductOpt[]>('/products?status=aktif'),
    staleTime: 5 * 60_000,
  });
  const indoorOpts = (products.data ?? []).filter((p) => p.acRole === 'indoor');
  const outdoorOpts = (products.data ?? []).filter((p) => p.acRole === 'outdoor');

  const mutation = useMutation({
    mutationFn: (payload: unknown) => apiClient.post<ImportResult>('/legacy-import', payload),
    onSuccess: (res) => {
      setResult(res);
      toast.success('Data lampau tersimpan.');
      qc.invalidateQueries({ queryKey: ['unit-labels'] });
      qc.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan data lampau.'),
  });

  function patchUnit(key: number, patch: Partial<UnitRow>) {
    setUnits((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function patchItem(key: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function reset() {
    setResult(null);
    setSelected(null);
    setQuery('');
    setName('');
    setPhone('');
    setAddress('');
    setUnits([newUnit()]);
    setWithInvoice(false);
    setInvDate('');
    setItems([newItem()]);
    setInvDiscount('');
    setInvPaid('');
    setInvNotes('');
  }

  const subtotal = items.reduce((s, it) => s + Math.round((Number(it.qty) || 0) * (Number(it.unitPrice) || 0)), 0);
  const grand = Math.max(0, subtotal - (Number(invDiscount) || 0));

  function validate(): string | null {
    if (memberMode === 'existing' && !selected) return 'Pilih member dulu, atau pindah ke "Member Baru".';
    if (memberMode === 'baru' && !name.trim()) return 'Nama member wajib diisi.';
    const effectiveAddress = (address.trim() || (memberMode === 'existing' ? selected?.address?.trim() : '')) ?? '';
    for (const [i, u] of units.entries()) {
      const no = `Unit #${i + 1}`;
      if (u.mode === 'qr_dulu' && !effectiveAddress) {
        return `${no}: alamat member wajib diisi untuk mode "QR dulu" (tercetak di label).`;
      }
      if (u.mode === 'diketahui') {
        const hasType =
          u.source === 'master' ? !!(u.indoorProductId || u.outdoorProductId) : !!(u.brand.trim() || u.model.trim());
        if (!hasType) return `${no}: isi merk/model atau pilih produk. Kalau belum tahu, pakai mode "QR dulu".`;
        if (u.pk.trim() && Number.isNaN(Number(u.pk))) return `${no}: PK harus angka.`;
        if (u.serviceIntervalDays.trim()) {
          const err = intervalError(u.serviceIntervalDays);
          if (err) return `${no}: ${err}`;
        }
      }
    }
    if (units.length === 0 && !withInvoice) return 'Tambah minimal satu unit AC atau sertakan transaksi lampau.';
    if (withInvoice) {
      if (!invDate) return 'Tanggal transaksi lampau wajib diisi.';
      const valid = items.filter((it) => it.name.trim());
      if (valid.length === 0) return 'Transaksi lampau butuh minimal satu item.';
      if (valid.some((it) => !(Number(it.qty) > 0) || it.unitPrice === '' || Number.isNaN(Number(it.unitPrice)))) {
        return 'Qty dan harga item transaksi harus diisi dengan benar.';
      }
      if ((Number(invPaid) || 0) > grand) return 'Jumlah dibayar tidak boleh melebihi total transaksi.';
    }
    return null;
  }

  function submit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    mutation.mutate({
      member:
        memberMode === 'existing'
          ? { memberId: selected!.id, address: address.trim() || undefined }
          : { name: name.trim(), phone: phone.trim() || undefined, address: address.trim() || undefined },
      units: units.map((u) =>
        u.mode === 'qr_dulu'
          ? { mode: 'qr_dulu', roomLocation: u.roomLocation.trim() || undefined }
          : {
              mode: 'diketahui',
              roomLocation: u.roomLocation.trim() || undefined,
              ...(u.source === 'master'
                ? {
                    indoorProductId: u.indoorProductId || undefined,
                    outdoorProductId: u.outdoorProductId || undefined,
                  }
                : { brand: u.brand.trim() || undefined, model: u.model.trim() || undefined }),
              pk: u.pk.trim() ? Number(u.pk) : undefined,
              serialNumber: u.serialNumber.trim() || undefined,
              installationDate: u.installationDate || undefined,
              lastServiceDate: u.lastServiceDate || undefined,
              serviceIntervalDays: u.serviceIntervalDays.trim() ? Number(u.serviceIntervalDays) : undefined,
            },
      ),
      invoice: withInvoice
        ? {
            date: invDate,
            items: items
              .filter((it) => it.name.trim())
              .map((it) => ({ name: it.name.trim(), qty: Number(it.qty), unitPrice: Number(it.unitPrice) })),
            discount: Number(invDiscount) || undefined,
            totalPaid: Number(invPaid) || undefined,
            notes: invNotes.trim() || undefined,
          }
        : undefined,
    });
  }

  // ===== Hasil setelah simpan
  if (result) {
    const ids = result.units.map((u) => u.id).join(',');
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tersimpan: {result.member.name}</CardTitle>
          <CardDescription>
            {result.memberIsNew ? 'Member baru dibuat.' : 'Ditambahkan ke member yang sudah ada.'}
            {result.invoice && ` Transaksi lampau ${result.invoice.number} tercatat.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {result.units.length > 0 && (
            <div className="grid gap-2">
              {result.units.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                  <QrCode className="size-4 text-muted-foreground" />
                  <span className="font-mono">{u.barcodeValue}</span>
                  <span className="text-muted-foreground">
                    {[u.brand, u.model].filter(Boolean).join(' ') || 'Tipe belum diketahui'}
                    {u.roomLocation ? ` · ${u.roomLocation}` : ''}
                  </span>
                  {u.status === 'menunggu_data' && <Badge variant="warning">Menunggu data teknisi</Badge>}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {result.units.length > 0 && (
              <Button onClick={() => router.push(`/administrasi/data-lampau/cetak?ids=${encodeURIComponent(ids)}`)}>
                <Printer className="size-4" />
                Cetak Label QR ({result.units.length})
              </Button>
            )}
            <Button variant="outline" onClick={reset}>
              <Plus className="size-4" />
              Input Berikutnya
            </Button>
            <Button variant="ghost" onClick={onGoLabel}>
              Lihat daftar Label QR
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      {/* ===== Member */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Member</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {(['baru', 'existing'] as const).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={memberMode === m ? 'default' : 'outline'}
                onClick={() => setMemberMode(m)}
              >
                {m === 'baru' ? 'Member Baru' : 'Member yang Sudah Ada'}
              </Button>
            ))}
          </div>

          {memberMode === 'existing' ? (
            <div className="grid gap-3">
              {selected ? (
                <div className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <div>
                    <p className="font-medium">{selected.name}</p>
                    <p className="text-muted-foreground">{selected.phone || '-'}</p>
                    <p className="text-muted-foreground">{selected.address || 'Alamat belum tercatat'}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setSelected(null)}>
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Cari nama / no. HP (min. 2 huruf)"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <div className="grid max-w-sm gap-1">
                    {(search.data ?? []).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => setSelected(m)}
                      >
                        {m.name} <span className="text-muted-foreground">· {m.phone || '-'}</span>
                      </button>
                    ))}
                    {search.data?.length === 0 && <p className="text-sm text-muted-foreground">Tidak ketemu.</p>}
                  </div>
                </>
              )}
              {selected && (
                <Field label="Alamat (isi untuk menambah/memperbarui alamat member)">
                  <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={selected.address ?? ''} />
                </Field>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nama *">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="No. HP" hint="Boleh kosong kalau belum tahu.">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Alamat" hint='Tercetak di label QR. Wajib kalau ada unit mode "QR dulu".'>
                  <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
                </Field>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Unit AC */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Unit AC</CardTitle>
          <CardDescription>
            1 baris = 1 set AC (indoor + outdoor) = 1 QR. Tipe belum diketahui? Pilih &quot;QR dulu&quot;, teknisi
            yang melengkapi saat scan di lokasi.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {units.map((u, idx) => (
            <div key={u.key} className="grid gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Unit #{idx + 1}</span>
                  {(['diketahui', 'qr_dulu'] as const).map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={u.mode === m ? 'default' : 'outline'}
                      onClick={() => patchUnit(u.key, { mode: m })}
                    >
                      {m === 'diketahui' ? 'Tipe diketahui' : 'QR dulu (tipe belum tahu)'}
                    </Button>
                  ))}
                </div>
                {units.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => setUnits((r) => r.filter((x) => x.key !== u.key))}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>

              <Field label="Lokasi / ruangan">
                <Input value={u.roomLocation} onChange={(e) => patchUnit(u.key, { roomLocation: e.target.value })} placeholder="Kamar utama, Ruang tamu, ..." />
              </Field>

              {u.mode === 'diketahui' && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {(['bebas', 'master'] as const).map((s) => (
                      <Button key={s} type="button" size="sm" variant={u.source === s ? 'secondary' : 'ghost'} onClick={() => patchUnit(u.key, { source: s })}>
                        {s === 'bebas' ? 'Ketik bebas' : 'Pilih dari master produk'}
                      </Button>
                    ))}
                  </div>
                  {u.source === 'bebas' ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Merk">
                        <Input value={u.brand} onChange={(e) => patchUnit(u.key, { brand: e.target.value })} />
                      </Field>
                      <Field label="Model / tipe">
                        <Input value={u.model} onChange={(e) => patchUnit(u.key, { model: e.target.value })} />
                      </Field>
                      <Field label="PK">
                        <Input inputMode="decimal" value={u.pk} onChange={(e) => patchUnit(u.key, { pk: e.target.value })} placeholder="1, 1.5, 2" />
                      </Field>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Indoor">
                        <Select value={u.indoorProductId || NONE} onValueChange={(v) => patchUnit(u.key, { indoorProductId: v === NONE ? '' : v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>- tidak ada -</SelectItem>
                            {indoorOpts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Outdoor">
                        <Select value={u.outdoorProductId || NONE} onValueChange={(v) => patchUnit(u.key, { outdoorProductId: v === NONE ? '' : v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>- tidak ada -</SelectItem>
                            {outdoorOpts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="No. seri (opsional)">
                      <Input value={u.serialNumber} onChange={(e) => patchUnit(u.key, { serialNumber: e.target.value })} />
                    </Field>
                    <Field label="Tanggal pasang (opsional)">
                      <Input type="date" value={u.installationDate} onChange={(e) => patchUnit(u.key, { installationDate: e.target.value })} />
                    </Field>
                  </div>
                  <div className="grid gap-3 rounded-md bg-muted/50 p-3 sm:grid-cols-2">
                    <Field label="Servis terakhir (opsional)">
                      <Input type="date" value={u.lastServiceDate} onChange={(e) => patchUnit(u.key, { lastServiceDate: e.target.value })} />
                    </Field>
                    <Field label="Siklus servis (hari, 7–730)" hint="Kosongkan = pengingat WA OFF. Bisa diatur nanti di Monitoring Jadwal.">
                      <Input inputMode="numeric" value={u.serviceIntervalDays} onChange={(e) => patchUnit(u.key, { serviceIntervalDays: e.target.value })} placeholder="mis. 90" />
                    </Field>
                  </div>
                </>
              )}
              {u.mode === 'qr_dulu' && (
                <p className="text-xs text-muted-foreground">
                  Unit dibuat tanpa data tipe. Label QR memuat nama + alamat member + ruangan. Pengingat WA OFF sampai
                  datanya dilengkapi.
                </p>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setUnits((r) => [...r, newUnit()])}>
              <Plus className="size-4" /> Tambah Unit AC
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setUnits((r) => [...r, newUnit('qr_dulu')])}>
              <QrCode className="size-4" /> Tambah Unit &quot;QR dulu&quot;
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== Transaksi (opsional) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Checkbox id="with-invoice" checked={withInvoice} onCheckedChange={(v) => setWithInvoice(v === true)} />
            <Label htmlFor="with-invoice" className="text-base font-semibold">
              3. Sertakan transaksi lampau (opsional)
            </Label>
          </div>
          <CardDescription>Catatan histori saja - tidak memotong stok.</CardDescription>
        </CardHeader>
        {withInvoice && (
          <CardContent className="grid gap-4">
            <div className="max-w-xs">
              <Field label="Tanggal transaksi asli *">
                <Input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-2">
              {items.map((it) => (
                <div key={it.key} className="grid grid-cols-[1fr_5rem_9rem_auto] items-end gap-2">
                  <div className="col-span-2 sm:col-span-1"><Field label="Item"><Input value={it.name} onChange={(e) => patchItem(it.key, { name: e.target.value })} /></Field></div>
                  <Field label="Qty"><Input inputMode="decimal" value={it.qty} onChange={(e) => patchItem(it.key, { qty: e.target.value })} /></Field>
                  <Field label="Harga satuan"><CurrencyInput value={it.unitPrice} onChange={(v: string) => patchItem(it.key, { unitPrice: v })} /></Field>
                  <Button type="button" variant="ghost" size="icon" disabled={items.length === 1} onClick={() => setItems((r) => r.filter((x) => x.key !== it.key))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => setItems((r) => [...r, newItem()])}>
                  <Plus className="size-4" /> Tambah Item
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Diskon"><CurrencyInput value={invDiscount} onChange={(v: string) => setInvDiscount(v)} /></Field>
              <Field label="Sudah dibayar"><CurrencyInput value={invPaid} onChange={(v: string) => setInvPaid(v)} /></Field>
              <Field label="Total"><p className={cn('flex h-9 items-center text-sm font-semibold')}>{formatRupiah(grand)}</p></Field>
            </div>
            <Field label="Catatan"><Textarea rows={2} value={invNotes} onChange={(e) => setInvNotes(e.target.value)} /></Field>
          </CardContent>
        )}
      </Card>

      <div>
        <Button onClick={submit} disabled={mutation.isPending}>
          <Save className="size-4" />
          {mutation.isPending ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </div>
    </div>
  );
}
