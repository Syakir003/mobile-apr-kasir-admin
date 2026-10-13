// Tipe pembeli (2026-10-13) — jenis member yang menentukan harga & hak beli
// di POS. Padanan enum PriceTier di backend (common/price-tier.util.ts).
// Ritel: AC, Sparepart, Jasa. Installer & Reseller: AC dan Sparepart saja.
export type PriceTier = 'retail' | 'installer' | 'reseller';

export const TIER_LABEL: Record<PriceTier, string> = {
  retail: 'Ritel',
  installer: 'Installer',
  reseller: 'Reseller',
};

export const TIER_OPTIONS: { value: PriceTier; label: string; hint: string }[] = [
  { value: 'retail', label: 'Ritel', hint: 'Pembeli/pemakai langsung' },
  { value: 'installer', label: 'Installer', hint: 'Teknisi, jual lagi ke pelanggannya' },
  { value: 'reseller', label: 'Reseller', hint: 'Punya toko, jual lagi' },
];
