'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { MAPS_INPUT_PLACEHOLDER, mapsInputDisplay } from '@/lib/maps-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

// Multi lokasi member: Lokasi 1 = alamat utama member (diubah lewat Ubah Data Member), lokasi lain = baris di sini.

export interface MemberLocationRow {
  id: string;
  name: string;
  address: string | null;
  mapsUrl: string | null;
}

export interface LocationMember {
  id: string;
  address: string | null;
  mapsUrl?: string | null;
  multiLocation: boolean;
  mainLocationName: string | null;
  locations: MemberLocationRow[];
}

/** Nilai `locationId` untuk Lokasi 1 (alamat utama) di body request ke backend. */
export const MAIN_LOCATION = 'utama';

export const mainLocationLabel = (m: { mainLocationName: string | null }) => m.mainLocationName?.trim() || 'Lokasi 1';

/** Nama lokasi sebuah unit pada member multi lokasi (null bila member tidak memakai multi lokasi). */
export function unitLocationName(
  member: { multiLocation: boolean; mainLocationName: string | null },
  unit: { location?: { name: string } | null },
): string | null {
  return member.multiLocation ? (unit.location?.name ?? mainLocationLabel(member)) : null;
}

/** Kartu "Lokasi" di halaman member: Lokasi 1 (utama) + lokasi tambahan, dengan tambah/ubah/hapus. */
export function LocationsCard({ member, canEdit }: { member: LocationMember; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState<MemberLocationRow | 'new' | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/members/${member.id}/locations/${id}`),
    onSuccess: () => {
      toast.success('Lokasi dihapus.');
      queryClient.invalidateQueries({ queryKey: ['members', member.id] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menghapus lokasi.'),
  });

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-sm">
      <CardHeader className="border-b bg-muted/60 py-4">
        <CardTitle className="flex items-center gap-2 text-base">
          Lokasi
          <Badge variant="secondary">{1 + member.locations.length}</Badge>
        </CardTitle>
        <CardDescription>
          Tempat AC member ini berada. Admin memilih lokasinya saat membuat job, dan AC baru mengikuti lokasi itu.
        </CardDescription>
        {canEdit && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              <Plus className="size-4" />
              Tambah Lokasi
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-3 py-5 text-sm">
        <LocationItem
          name={mainLocationLabel(member)}
          badge="Utama"
          address={member.address}
          mapsUrl={member.mapsUrl ?? null}
          hint="Alamat utama member. Ubah lewat tombol pensil di kartu Data Member."
        />
        {member.locations.map((loc) => (
          <LocationItem
            key={loc.id}
            name={loc.name}
            address={loc.address}
            mapsUrl={loc.mapsUrl}
            actions={
              canEdit ? (
                <>
                  <Button variant="ghost" size="icon" title="Ubah lokasi" onClick={() => setEditing(loc)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Hapus lokasi"
                    disabled={remove.isPending}
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Hapus lokasi "${loc.name}"?`)) remove.mutate(loc.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              ) : undefined
            }
          />
        ))}
        {member.locations.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Belum ada lokasi lain. Tambahkan lokasi (mis. kantor baru), lalu pindahkan unit-unit AC-nya dari daftar Unit AC.
          </p>
        )}
      </CardContent>
      {editing && (
        <LocationDialog
          memberId={member.id}
          location={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function LocationItem({
  name,
  badge,
  address,
  mapsUrl,
  hint,
  actions,
}: {
  name: string;
  badge?: string;
  address: string | null;
  mapsUrl: string | null;
  hint?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {name}
          {badge && <Badge variant="secondary">{badge}</Badge>}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{address || '-'}</p>
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
            Buka di Maps
          </a>
        )}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center">{actions}</div>}
    </div>
  );
}

/** Dialog tambah (location = null) atau ubah satu lokasi tambahan. Dirender hanya saat terbuka, jadi isian selalu segar. */
function LocationDialog({
  memberId,
  location,
  onClose,
}: {
  memberId: string;
  location: MemberLocationRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(location?.name ?? '');
  const [address, setAddress] = React.useState(location?.address ?? '');
  const [mapsUrl, setMapsUrl] = React.useState(mapsInputDisplay(location?.mapsUrl));

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), address: address.trim(), mapsUrl: mapsUrl.trim() };
      return location
        ? apiClient.patch(`/members/${memberId}/locations/${location.id}`, body)
        : apiClient.post(`/members/${memberId}/locations`, body);
    },
    onSuccess: () => {
      toast.success(location ? 'Lokasi diperbarui.' : 'Lokasi ditambahkan.');
      queryClient.invalidateQueries({ queryKey: ['members', memberId] });
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan lokasi.'),
  });

  const invalid = !name.trim() || (!address.trim() && !mapsUrl.trim());

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{location ? 'Ubah Lokasi' : 'Tambah Lokasi'}</DialogTitle>
          <DialogDescription>
            Alamat dan link Maps ini menjadi lokasi kerja job dan alamat di label QR untuk unit di lokasi ini.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="loc-name">Nama lokasi</Label>
            <Input id="loc-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Mis. Kantor Baru" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="loc-address">Alamat</Label>
            <Textarea id="loc-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Alamat lokasi ini" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="loc-maps">Link Lokasi (Google Maps)</Label>
            <Input id="loc-maps" value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder={MAPS_INPUT_PLACEHOLDER} />
            <p className="text-xs text-muted-foreground">Isi alamat atau link Maps (minimal salah satu).</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
            Batal
          </Button>
          <Button type="button" disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pindahkan unit AC yang dicentang ke satu lokasi (POST /members/:id/units/move-location). */
export function MoveUnitsBar({
  member,
  selectedIds,
  onMoved,
}: {
  member: LocationMember;
  selectedIds: string[];
  onMoved: () => void;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = React.useState('');

  const move = useMutation({
    mutationFn: () =>
      apiClient.post<{ moved: number; locationName: string | null }>(`/members/${member.id}/units/move-location`, {
        unitIds: selectedIds,
        locationId: target,
      }),
    onSuccess: (r) => {
      toast.success(`${r.moved} unit dipindahkan ke ${r.locationName ?? 'lokasi terpilih'}.`);
      queryClient.invalidateQueries({ queryKey: ['members', member.id] });
      setTarget('');
      onMoved();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal memindahkan unit.'),
  });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
      <span className="font-medium">{selectedIds.length} unit dipilih</span>
      <Select value={target} onValueChange={setTarget}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Pindahkan ke lokasi..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={MAIN_LOCATION}>{mainLocationLabel(member)} (utama)</SelectItem>
          {member.locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" disabled={!target || move.isPending} onClick={() => move.mutate()}>
        {move.isPending ? 'Memindahkan...' : 'Pindahkan'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Lokasi tambahan di dialog "Ubah Member": semua perubahan disimpan sekaligus saat Simpan (data member dulu, lalu lokasi).
// ---------------------------------------------------------------------------------------------------------------------

/** Satu baris lokasi tambahan di dialog Ubah Member (belum tentu tersimpan). `id` kosong = lokasi baru. */
export interface LocationDraft {
  key: string;
  id?: string;
  name: string;
  address: string;
  mapsUrl: string;
  /** Lokasi yang sudah ada dan ditandai hapus (dihapus saat Simpan). */
  removed: boolean;
}

let draftSeq = 0;
export const blankLocationDraft = (): LocationDraft => ({
  key: `new-${++draftSeq}`,
  name: '',
  address: '',
  mapsUrl: '',
  removed: false,
});

export function draftsFromLocations(locations: MemberLocationRow[]): LocationDraft[] {
  return locations.map((l) => ({
    key: l.id,
    id: l.id,
    name: l.name,
    address: l.address ?? '',
    mapsUrl: mapsInputDisplay(l.mapsUrl),
    removed: false,
  }));
}

/** Periksa isian lokasi sebelum disimpan. Mengembalikan pesan kesalahan pertama, atau null bila lolos. */
export function validateLocationDrafts(drafts: LocationDraft[], mainName: string | null): string | null {
  const seen = new Set<string>([mainLocationLabel({ mainLocationName: mainName }).toLowerCase()]);
  for (const d of drafts.filter((x) => !x.removed)) {
    const name = d.name.trim();
    if (!name) return 'Nama lokasi tambahan wajib diisi.';
    if (!d.address.trim() && !d.mapsUrl.trim()) return `Lokasi "${name}": isi alamat atau link Maps.`;
    const key = name.toLowerCase();
    if (seen.has(key)) return `Nama lokasi "${name}" dipakai lebih dari sekali (termasuk nama Lokasi 1).`;
    seen.add(key);
  }
  return null;
}

/**
 * Terapkan perubahan lokasi ke server: hapus dulu (nama yang dibebaskan boleh dipakai lokasi baru), lalu ubah yang berubah,
 * lalu tambah. Satu yang gagal tidak menghentikan yang lain; hasilnya `errors` (pesan per lokasi) dan id lokasi yang baru dibuat.
 */
export async function applyLocationDrafts(memberId: string, original: MemberLocationRow[], drafts: LocationDraft[]) {
  const errors: string[] = [];
  const createdIds: string[] = [];
  const body = (d: LocationDraft) => ({ name: d.name.trim(), address: d.address.trim(), mapsUrl: d.mapsUrl.trim() });
  const why = (e: unknown) => (e instanceof ApiError ? e.message : 'gagal disimpan');

  for (const d of drafts.filter((x) => x.id && x.removed)) {
    try {
      await apiClient.delete(`/members/${memberId}/locations/${d.id}`);
    } catch (e) {
      errors.push(`Hapus "${d.name}": ${why(e)}`);
    }
  }
  for (const d of drafts.filter((x) => x.id && !x.removed)) {
    const o = original.find((l) => l.id === d.id);
    const unchanged =
      !!o &&
      o.name === d.name.trim() &&
      (o.address ?? '') === d.address.trim() &&
      mapsInputDisplay(o.mapsUrl) === d.mapsUrl.trim();
    if (unchanged) continue;
    try {
      await apiClient.patch(`/members/${memberId}/locations/${d.id}`, body(d));
    } catch (e) {
      errors.push(`Ubah "${d.name}": ${why(e)}`);
    }
  }
  for (const d of drafts.filter((x) => !x.id)) {
    try {
      const res = await apiClient.post<{ id: string }>(`/members/${memberId}/locations`, body(d));
      createdIds.push(res.id);
    } catch (e) {
      errors.push(`Tambah "${d.name}": ${why(e)}`);
    }
  }
  return { errors, createdIds };
}

/** Daftar lokasi tambahan yang bisa ditambah/diubah/dihapus di dalam dialog Ubah Member (belum disimpan sampai Simpan). */
export function LocationDraftsEditor({
  drafts,
  onChange,
}: {
  drafts: LocationDraft[];
  onChange: (next: LocationDraft[]) => void;
}) {
  const live = drafts.filter((d) => !d.removed);
  const patchDraft = (key: string, patch: Partial<LocationDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  // Lokasi yang sudah tersimpan ditandai hapus (dihapus saat Simpan); lokasi baru langsung dibuang dari daftar.
  const removeDraft = (d: LocationDraft) =>
    onChange(d.id ? drafts.map((x) => (x.key === d.key ? { ...x, removed: true } : x)) : drafts.filter((x) => x.key !== d.key));

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">Lokasi tambahan</p>
        <p className="text-xs text-muted-foreground">
          Lokasi lain selain Lokasi 1 (mis. Kantor Baru). Disimpan saat menekan Simpan; sesudah itu unit AC bisa dipindahkan
          ke lokasi baru.
        </p>
      </div>
      {live.length === 0 && <p className="text-xs text-muted-foreground">Belum ada lokasi tambahan.</p>}
      {live.map((d, i) => (
        <div key={d.key} className="grid gap-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Lokasi {i + 2}
              {d.id ? '' : ' (baru)'}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Hapus lokasi"
              className="size-7 text-destructive hover:text-destructive"
              onClick={() => removeDraft(d)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <Input
            aria-label={`Nama lokasi ${i + 2}`}
            value={d.name}
            maxLength={100}
            placeholder="Nama lokasi, mis. Kantor Baru"
            onChange={(e) => patchDraft(d.key, { name: e.target.value })}
          />
          <Textarea
            aria-label={`Alamat lokasi ${i + 2}`}
            rows={2}
            value={d.address}
            placeholder="Alamat lokasi ini"
            onChange={(e) => patchDraft(d.key, { address: e.target.value })}
          />
          <Input
            aria-label={`Link Maps lokasi ${i + 2}`}
            value={d.mapsUrl}
            placeholder={MAPS_INPUT_PLACEHOLDER}
            onChange={(e) => patchDraft(d.key, { mapsUrl: e.target.value })}
          />
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...drafts, blankLocationDraft()])}>
          <Plus className="size-4" />
          Tambah lokasi
        </Button>
      </div>
    </div>
  );
}

export interface MovableUnit {
  id: string;
  brand: string | null;
  model: string | null;
  roomLocation: string | null;
  locationId?: string | null;
  location?: { id: string; name: string } | null;
}

/**
 * Tawaran sesudah lokasi baru dibuat: pilih unit yang pindah ke lokasi itu (POST /members/:id/units/move-location). Hanya
 * unit yang belum berada di lokasi tujuan yang ditampilkan; unit dengan job aktif akan ditolak server beserta alasannya.
 */
export function MoveUnitsDialog({
  member,
  units,
  initialTarget,
  onClose,
}: {
  member: LocationMember;
  units: MovableUnit[];
  initialTarget: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = React.useState(initialTarget);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const candidates = units.filter((u) => (u.locationId ?? MAIN_LOCATION) !== target);
  const allSelected = candidates.length > 0 && candidates.every((u) => selected.has(u.id));
  const targetName =
    target === MAIN_LOCATION ? mainLocationLabel(member) : (member.locations.find((l) => l.id === target)?.name ?? 'lokasi ini');

  const move = useMutation({
    mutationFn: () =>
      apiClient.post<{ moved: number; locationName: string | null }>(`/members/${member.id}/units/move-location`, {
        unitIds: [...selected],
        locationId: target,
      }),
    onSuccess: (r) => {
      toast.success(`${r.moved} unit dipindahkan ke ${r.locationName ?? targetName}.`);
      queryClient.invalidateQueries({ queryKey: ['members', member.id] });
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal memindahkan unit.'),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !move.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pindahkan unit ke lokasi baru?</DialogTitle>
          <DialogDescription>
            Centang unit AC yang berada di {targetName}. Boleh dilewati dan dilakukan nanti dari tabel Unit AC.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="move-target">Lokasi tujuan</Label>
            <Select
              value={target}
              onValueChange={(v) => {
                setTarget(v);
                setSelected(new Set());
              }}
            >
              <SelectTrigger id="move-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MAIN_LOCATION}>{mainLocationLabel(member)} (utama)</SelectItem>
                {member.locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Semua unit sudah berada di {targetName}.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(candidates.map((u) => u.id)))}
                >
                  {allSelected ? 'Kosongkan' : 'Pilih semua'}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {selected.size} dari {candidates.length} unit dipilih
                </span>
              </div>
              <ul className="grid max-h-72 gap-1.5 overflow-y-auto">
                {candidates.map((u) => (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm">
                      <Checkbox
                        checked={selected.has(u.id)}
                        onCheckedChange={(c) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (c === true) next.add(u.id);
                            else next.delete(u.id);
                            return next;
                          })
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{[u.brand, u.model].filter(Boolean).join(' ') || 'Unit AC'}</span>
                        {u.roomLocation ? ` - ${u.roomLocation}` : ''}
                        <span className="block text-xs text-muted-foreground">
                          Sekarang di: {unitLocationName(member, u) ?? '-'}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={move.isPending} onClick={onClose}>
            Lewati
          </Button>
          <Button type="button" disabled={selected.size === 0 || move.isPending} onClick={() => move.mutate()}>
            {move.isPending ? 'Memindahkan...' : `Pindahkan (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
