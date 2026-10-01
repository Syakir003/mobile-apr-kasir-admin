import { Prisma } from '@prisma/client';

/** Field minimal dari Product yang dibutuhkan buat resolve data MemberAcUnit. */
export interface PairableProduct {
  id: string;
  brand?: string | null;
  type?: string | null;
  pk?: Prisma.Decimal | number | null;
  pairedProductId?: string | null;
  // Paket AC Split (2026-09-30) — 'indoor' | 'outdoor' | null (Product.acRole).
  acRole?: string | null;
}

export interface AcUnitPairFields {
  indoorProductId: string | null;
  outdoorProductId: string | null;
  brand: string | null;
  model: string | null;
  pk: Prisma.Decimal | number | null;
}

/**
 * Nentuin indoorProductId/outdoorProductId + brand/model/pk gabungan buat
 * MemberAcUnit, dari 1-2 Product yang lagi diinstal dalam SATU aksi.
 *
 * Konvensi urutan (Point 2, 2026-09-23): kalau `products` panjangnya 2,
 * elemen ke-0 SELALU Indoor dan ke-1 SELALU Outdoor — ini dijamin oleh
 * PEMANGGIL (PosService.checkout, lewat urutan itemIndexes) bukan ditebak
 * di sini. Kalau cuma 1 elemen: dianggap Indoor HANYA kalau dia sendiri
 * punya `pairedProductId` (produk yang dikonfigurasi sebagai sisi Indoor
 * sebuah pasangan) — selain itu (produk non-AC/gak ber-pair, atau Outdoor
 * yang dijual berdiri sendiri) dua-duanya null, sama seperti perilaku
 * sebelum kolom ini ada.
 */
export function resolveAcUnitPairFields(products: PairableProduct[]): AcUnitPairFields {
  if (products.length === 0 || products.length > 2) {
    throw new Error('resolveAcUnitPairFields butuh 1 atau 2 produk');
  }

  const [first, second] = products;
  const brand = first.brand ?? second?.brand ?? null;
  // Dua unit dengan tipe sama (mis. dua-duanya "Split") jangan ditulis
  // "Split + Split" — cukup sekali.
  const model =
    products.length === 2
      ? [...new Set([first.type, second.type].filter(Boolean))].join(' + ') || null
      : (first.type ?? null);
  const pk = first.pk ?? second?.pk ?? null;

  if (products.length === 2) {
    return { indoorProductId: first.id, outdoorProductId: second.id, brand, model, pk };
  }

  // 1 produk: Indoor kalau dia sisi Indoor sebuah pasangan (pairedProductId)
  // atau diberi peran 'indoor'; Outdoor kalau perannya 'outdoor' (Outdoor
  // dijual satuan sebelumnya gak tercatat sama sekali).
  const isIndoor = !!first.pairedProductId || first.acRole === 'indoor';
  const isOutdoor = !isIndoor && first.acRole === 'outdoor';
  return {
    indoorProductId: isIndoor ? first.id : null,
    outdoorProductId: isOutdoor ? first.id : null,
    brand,
    model,
    pk,
  };
}
