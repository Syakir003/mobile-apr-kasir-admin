import { BadRequestException } from '@nestjs/common';

/**
 * Tipe pembeli (2026-10-13) — jenis member yang menentukan HARGA dan HAK
 * BELI di POS. Bukan role login (admin/kasir/teknisi/gudang tidak berubah).
 *   retail    = pembeli/pemakai langsung: AC, Sparepart, Jasa, Paket Instalasi
 *   installer = teknisi luar, jual lagi: AC, Sparepart
 *   reseller  = punya toko, jual lagi (paling murah): AC, Sparepart
 */
export const PRICE_TIERS = ['retail', 'installer', 'reseller'] as const;
export type PriceTierName = (typeof PRICE_TIERS)[number];

export const NON_RETAIL_TIERS = ['installer', 'reseller'] as const;
export type NonRetailTier = (typeof NON_RETAIL_TIERS)[number];

export const TIER_LABEL: Record<PriceTierName, string> = {
  retail: 'Ritel',
  installer: 'Installer',
  reseller: 'Reseller',
};

export function isNonRetail(tier: PriceTierName): tier is NonRetailTier {
  return tier !== 'retail';
}

/**
 * Hak beli: Installer/Reseller cuma boleh AC & Sparepart. Jasa dan instalasi
 * (unit AC member + job pemasangan + paket instalasi) khusus Ritel — mereka
 * beli unit buat dijual lagi, bukan dipasang oleh toko.
 */
export function assertTierCanBuy(
  tier: PriceTierName,
  items: { kind: string }[],
  installations?: unknown[] | null,
): void {
  if (!isNonRetail(tier)) return;
  const label = TIER_LABEL[tier];
  if (items.some((i) => i.kind === 'service')) {
    throw new BadRequestException(
      `Member ${label} tidak bisa membeli Jasa — hanya AC dan Sparepart`,
    );
  }
  if (installations && installations.length > 0) {
    throw new BadRequestException(
      `Member ${label} tidak bisa memakai instalasi/Paket Instalasi — hanya AC dan Sparepart`,
    );
  }
}

/**
 * Harga satuan untuk tipe non-retail. Harga yang belum diisi DITOLAK, bukan
 * jatuh ke harga Ritel — lebih baik kasir berhenti daripada diam-diam
 * menagih harga yang salah. `saleKind==='utuh'` (sparepart) pakai pricePack.
 */
export function resolveTierUnitPrice(
  tier: NonRetailTier,
  itemName: string,
  row: { price: number; pricePack: number | null } | undefined,
  saleKind?: string | null,
): number {
  const label = TIER_LABEL[tier];
  if (!row) {
    throw new BadRequestException(
      `Harga ${label} untuk ${itemName} belum diisi — lengkapi di Data Master`,
    );
  }
  if (saleKind === 'utuh') {
    if (row.pricePack === null) {
      throw new BadRequestException(
        `Harga ${label} (utuh) untuk ${itemName} belum diisi — lengkapi di Data Master`,
      );
    }
    return row.pricePack;
  }
  return row.price;
}
