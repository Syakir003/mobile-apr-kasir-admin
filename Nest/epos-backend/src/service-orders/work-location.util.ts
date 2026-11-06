import { BadRequestException } from '@nestjs/common';

export interface WorkLocationInput {
  address?: string;
  mapsUrl?: string;
}

/**
 * Titik lokasi kerja satu unit pada Terima Servis. `index` = pilihan unit ke daftar `locations`; tanpa pilihan, titik
 * tunggal dipakai semua unit, dan kalau titiknya banyak unit ikut alamat pelanggan (null). Titik tanpa isi juga berarti
 * "ikut alamat pelanggan" (null/null) — admin cukup mengosongkannya.
 */
export function resolveWorkLocation(
  locations: WorkLocationInput[] | undefined,
  index: number | undefined,
): { workAddress: string | null; workMapsUrl: string | null } {
  const list = locations ?? [];
  const i = index ?? (list.length === 1 ? 0 : undefined);
  if (i === undefined) return { workAddress: null, workMapsUrl: null };
  const loc = list[i];
  if (!loc) throw new BadRequestException('Titik lokasi kerja yang dipilih untuk unit ini tidak ada');
  return { workAddress: loc.address?.trim() || null, workMapsUrl: loc.mapsUrl?.trim() || null };
}
