import { Prisma } from '@prisma/client';

/**
 * Paket AC Split (2026-09-30) — 1 MemberAcUnit = 1 paket AC, yang bisa
 * terdiri dari unit Indoor + Outdoor (kolom indoorProductId/outdoorProductId).
 * Include ini dipakai SEMUA endpoint yang ngembaliin unit AC supaya frontend
 * bisa nampilin nama tipe tiap unit (mis. "AC FT123" + "AC FK123").
 */
export const UNIT_PRODUCTS_SELECT = {
  indoorProduct: { select: { id: true, name: true, sku: true } },
  outdoorProduct: { select: { id: true, name: true, sku: true } },
} satisfies Prisma.MemberAcUnitInclude;
