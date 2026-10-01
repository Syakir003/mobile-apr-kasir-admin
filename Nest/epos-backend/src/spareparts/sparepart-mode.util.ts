import { BadRequestException } from '@nestjs/common';

/** Mode pelacakan & penjualan sparepart (2026-09-30). Lihat komentar
 * `Sparepart.trackingMode` di schema.prisma. */
export const SPAREPART_MODES = ['biasa', 'gulungan', 'konversi', 'gabungan'] as const;
export type SparepartMode = (typeof SPAREPART_MODES)[number];

/** Dilacak per roll/tabung (banyak baris item_costs) => batchTracked=true. */
export function isBatchMode(mode: SparepartMode): boolean {
  return mode === 'gulungan' || mode === 'gabungan';
}

/** Bisa dijual utuh (1 packUnit = packSize unit) selain eceran. */
export function hasPackSale(mode: string): boolean {
  return mode === 'konversi' || mode === 'gabungan';
}

export interface SparepartModeInput {
  trackingMode?: string;
  batchTracked?: boolean;
  packUnit?: string | null;
  packSize?: number | null;
  sellPricePack?: number | null;
}

export interface SparepartModeFields {
  trackingMode: SparepartMode;
  batchTracked: boolean;
  packUnit: string | null;
  packSize: number | null;
  sellPricePack: number | null;
}

/**
 * Gabung input mode + field kemasan jadi satu set nilai konsisten yang siap
 * ditulis ke DB. `current` = state sparepart sekarang (kalau update): field
 * yang gak dikirim diwarisi dari sana.
 * - trackingMode gak dikirim => turun dari batchTracked (klien lama).
 * - Mode tanpa kemasan (biasa/gulungan) => packUnit/packSize/sellPricePack di-null-kan.
 * - Mode konversi/gabungan => packUnit, packSize > 0, sellPricePack > 0 wajib.
 */
export function resolveSparepartMode(
  input: SparepartModeInput,
  current?: {
    trackingMode: string;
    batchTracked: boolean;
    packUnit: string | null;
    packSize: number | null;
    sellPricePack: number | null;
  },
): SparepartModeFields {
  let mode: string;
  if (input.trackingMode !== undefined) mode = input.trackingMode;
  else if (input.batchTracked !== undefined) {
    // Klien lama cuma kirim batchTracked: pertahankan mode kemasan kalau
    // cocok (gabungan<->true, konversi<->false), selain itu turun biasa.
    const cur = current?.trackingMode;
    if (input.batchTracked) mode = cur === 'gabungan' ? 'gabungan' : 'gulungan';
    else mode = cur === 'konversi' ? 'konversi' : 'biasa';
  } else mode = current?.trackingMode ?? 'biasa';

  if (!(SPAREPART_MODES as readonly string[]).includes(mode)) {
    throw new BadRequestException(`Mode sparepart tidak dikenal: ${mode}`);
  }
  const m = mode as SparepartMode;

  if (!hasPackSale(m)) {
    return { trackingMode: m, batchTracked: isBatchMode(m), packUnit: null, packSize: null, sellPricePack: null };
  }

  const packUnit = (input.packUnit !== undefined ? input.packUnit : current?.packUnit)?.trim() || null;
  const packSize = input.packSize !== undefined ? input.packSize : (current?.packSize ?? null);
  const sellPricePack = input.sellPricePack !== undefined ? input.sellPricePack : (current?.sellPricePack ?? null);

  if (!packUnit) throw new BadRequestException('Satuan besar (mis. roll/tabung/dus) wajib diisi untuk mode ini');
  if (packSize === null || !(packSize > 0)) {
    throw new BadRequestException('Isi per satuan besar harus lebih dari 0');
  }
  if (Math.round(packSize * 100) !== packSize * 100 && Math.abs(Math.round(packSize * 100) - packSize * 100) > 1e-6) {
    throw new BadRequestException('Isi per satuan besar maksimal 2 angka di belakang koma');
  }
  if (sellPricePack === null || !(sellPricePack > 0)) {
    throw new BadRequestException('Harga jual utuh wajib diisi (lebih dari 0) untuk mode ini');
  }
  return { trackingMode: m, batchTracked: isBatchMode(m), packUnit, packSize, sellPricePack };
}
