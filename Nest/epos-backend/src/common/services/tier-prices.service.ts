import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NON_RETAIL_TIERS,
  NonRetailTier,
  TIER_LABEL,
} from '../price-tier.util';

export type TierPriceKind = 'product' | 'sparepart';

/** Field harga per tipe di DTO/response master data. `undefined` = tidak
 * diubah, `null` = kosongkan (tipe itu jadi tidak bisa membeli item ini). */
export interface TierPriceInput {
  priceInstaller?: number | null;
  priceReseller?: number | null;
  pricePackInstaller?: number | null;
  pricePackReseller?: number | null;
}

export interface TierPriceFields {
  priceInstaller: number | null;
  priceReseller: number | null;
  pricePackInstaller: number | null;
  pricePackReseller: number | null;
}

const EMPTY: TierPriceFields = {
  priceInstaller: null,
  priceReseller: null,
  pricePackInstaller: null,
  pricePackReseller: null,
};

/** Nama field `TierPriceInput` yang termasuk harga per tipe — dipakai service
 * master data buat misahin field ini dari data kolom Product/Sparepart. */
export const TIER_PRICE_KEYS = [
  'priceInstaller',
  'priceReseller',
  'pricePackInstaller',
  'pricePackReseller',
] as const;

/**
 * Harga jual per tipe pembeli non-retail (tabel tier_prices). Harga Ritel
 * TIDAK lewat sini — tetap kolom sellPrice/sellPricePack masing-masing.
 */
@Injectable()
export class TierPricesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Harga per tipe untuk banyak item sekaligus, bentuk field datar. */
  async fieldsFor(
    kind: TierPriceKind,
    refIds: string[],
  ): Promise<Map<string, TierPriceFields>> {
    const result = new Map<string, TierPriceFields>();
    if (refIds.length === 0) return result;
    const rows = await this.prisma.tierPrice.findMany({
      where: { kind, refId: { in: refIds } },
    });
    for (const row of rows) {
      const fields = result.get(row.refId) ?? { ...EMPTY };
      const price = Number(row.price);
      const pricePack = row.pricePack === null ? null : Number(row.pricePack);
      if (row.tier === 'installer') {
        fields.priceInstaller = price;
        fields.pricePackInstaller = pricePack;
      } else if (row.tier === 'reseller') {
        fields.priceReseller = price;
        fields.pricePackReseller = pricePack;
      }
      result.set(row.refId, fields);
    }
    return result;
  }

  /** Tempelkan field harga per tipe ke daftar item master data. */
  async attach<T extends { id: string }>(
    kind: TierPriceKind,
    items: T[],
  ): Promise<(T & TierPriceFields)[]> {
    const map = await this.fieldsFor(
      kind,
      items.map((i) => i.id),
    );
    return items.map((i) => ({ ...i, ...(map.get(i.id) ?? EMPTY) }));
  }

  /** Dipakai checkout — harga 1 item untuk 1 tipe (undefined = belum diisi). */
  async find(
    tx: Prisma.TransactionClient,
    kind: TierPriceKind,
    refId: string,
    tier: NonRetailTier,
  ): Promise<{ price: number; pricePack: number | null } | undefined> {
    const row = await tx.tierPrice.findUnique({
      where: { kind_refId_tier: { kind, refId, tier } },
    });
    if (!row) return undefined;
    return {
      price: Number(row.price),
      pricePack: row.pricePack === null ? null : Number(row.pricePack),
    };
  }

  /** Simpan perubahan harga per tipe dari form master data. */
  async save(
    tx: Prisma.TransactionClient,
    kind: TierPriceKind,
    refId: string,
    input: TierPriceInput,
  ) {
    for (const tier of NON_RETAIL_TIERS) {
      const price =
        tier === 'installer' ? input.priceInstaller : input.priceReseller;
      const pricePack =
        tier === 'installer'
          ? input.pricePackInstaller
          : input.pricePackReseller;
      if (price === undefined && pricePack === undefined) continue;

      const where = { kind_refId_tier: { kind, refId, tier } };
      if (price === null) {
        await tx.tierPrice.deleteMany({ where: { kind, refId, tier } });
        continue;
      }
      if (price !== undefined) {
        await tx.tierPrice.upsert({
          where,
          create: { kind, refId, tier, price, pricePack: pricePack ?? null },
          update: { price, ...(pricePack !== undefined ? { pricePack } : {}) },
        });
        continue;
      }
      // Cuma harga utuh yang dikirim — baris harga eceran-nya harus sudah ada.
      const existing = await tx.tierPrice.findUnique({ where });
      if (!existing) {
        if (pricePack === null) continue;
        throw new BadRequestException(
          `Isi dulu harga ${TIER_LABEL[tier]} (eceran) sebelum harga utuh-nya`,
        );
      }
      await tx.tierPrice.update({ where, data: { pricePack } });
    }
  }
}

/** Pisahkan field harga per tipe dari sisa DTO (yang jadi data kolom). */
export function splitTierPrices<T extends TierPriceInput>(
  dto: T,
): {
  tierPrices: TierPriceInput;
  rest: Omit<T, (typeof TIER_PRICE_KEYS)[number]>;
} {
  const {
    priceInstaller,
    priceReseller,
    pricePackInstaller,
    pricePackReseller,
    ...rest
  } = dto;
  return {
    tierPrices: {
      priceInstaller,
      priceReseller,
      pricePackInstaller,
      pricePackReseller,
    },
    rest,
  };
}
