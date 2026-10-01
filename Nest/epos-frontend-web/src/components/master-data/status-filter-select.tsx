'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type MasterDataStatus = 'active' | 'inactive' | 'all';

// Filter status generik dipakai di 4 halaman Master Data (Produk,
// Sparepart, Jasa, Paket Instalasi) — dampingan fitur nonaktifkan, biar
// item yang dinonaktifkan tetap bisa dicari & diaktifkan lagi.
export function StatusFilterSelect({
  value,
  onChange,
}: {
  value: MasterDataStatus;
  onChange: (value: MasterDataStatus) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MasterDataStatus)}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Aktif</SelectItem>
        <SelectItem value="inactive">Nonaktif</SelectItem>
        <SelectItem value="all">Semua</SelectItem>
      </SelectContent>
    </Select>
  );
}
