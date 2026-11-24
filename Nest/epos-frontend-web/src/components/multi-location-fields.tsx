'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Saklar "Aktifkan multi lokasi" untuk member (form Tambah/Ubah Member, pelanggan baru di Terima Servis dan Input Data
 * Lampau). Mati (bawaan) = perilaku lama: satu alamat. Menyala = satu member dengan AC di beberapa tempat (mis. kantor
 * lama dan kantor baru) tetap satu nomor HP: alamat utama menjadi Lokasi 1 (boleh diberi nama), lokasi lain ditambah di
 * halaman member, dan tiap AC baru memilih lokasinya.
 */
export function MultiLocationFields({
  enabled,
  onEnabledChange,
  mainName,
  onMainNameChange,
  idPrefix = 'multi-loc',
  disabled,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  mainName: string;
  onMainNameChange: (v: string) => void;
  idPrefix?: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(v) => onEnabledChange(v === true)}
          className="mt-0.5"
        />
        <span>
          Aktifkan multi lokasi
          <span className="block text-xs text-muted-foreground">
            Untuk pelanggan dengan AC di beberapa tempat (mis. kantor lama dan kantor baru) tetap dalam satu member dan satu
            nomor HP. Alamat utama menjadi Lokasi 1; lokasi lainnya ditambah di halaman member.
          </span>
        </span>
      </label>
      {enabled && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Nama Lokasi 1 (alamat utama)</Label>
          <Input
            id={`${idPrefix}-name`}
            value={mainName}
            maxLength={100}
            disabled={disabled}
            onChange={(e) => onMainNameChange(e.target.value)}
            placeholder='Mis. Kantor Lama (kosong = "Lokasi 1")'
          />
        </div>
      )}
    </div>
  );
}
