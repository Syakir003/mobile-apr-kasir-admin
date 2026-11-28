import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { map } from 'rxjs';

/** Semua nama kolom uang di API. Kolom jumlah barang (qty, stock, total unit) TIDAK termasuk.
 * Menambah kolom uang baru = tambahkan namanya di sini. */
export const PRICE_KEYS = new Set([
  'amount', 'basePrice', 'buyPrice', 'buyPriceDipakai', 'buyPriceSnapshot', 'closingBalance', 'cogs',
  'discount', 'discountValue', 'effectivePrice', 'extraPricePerUnit', 'grandTotal', 'hpp', 'lineTotal',
  'maxDiscountCap', 'minPurchase', 'modal', 'modalTersisa', 'omzet', 'omzetTerjual', 'openingBalance',
  'packageCostRef', 'price', 'pricePack', 'pricePackInstaller', 'pricePackReseller', 'priceInstaller',
  'priceReseller', 'priceSingle', 'revenue', 'sellPrice', 'sellPricePack', 'subtotal', 'taxAmount',
  'total', 'totalPaid', 'transportFee', 'unitCost', 'unitPrice', 'untungTerjual',
]);

const keep = (v: unknown) =>
  v === null || typeof v !== 'object' || v instanceof Date || v instanceof StreamableFile ||
  Buffer.isBuffer(v) || Prisma.Decimal.isDecimal(v);

/** Salinan `value` tanpa kolom harga. Baris barang diberi `pendingPrice` supaya klien
 * tetap tahu mana yang "menunggu harga" tanpa melihat harganya. */
export function hidePrices(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hidePrices);
  if (keep(value)) return value;
  const row = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(row)) {
    if (!PRICE_KEYS.has(key)) out[key] = hidePrices(v);
  }
  if ('sellPrice' in row && 'active' in row) {
    // "Menunggu harga": belum aktif dan harga jual (atau harga utuh) belum diisi.
    const packSale = row.trackingMode === 'konversi' || row.trackingMode === 'gabungan';
    out.pendingPrice =
      row.active === false &&
      row.acRole !== 'outdoor' &&
      (!(Number(row.sellPrice) > 0) || (packSale && !(Number(row.sellPricePack) > 0)));
  }
  return out;
}

/** Keputusan 2026-11-28: harga hanya untuk admin (kasir & teknisi sesuai kebutuhan kerjanya);
 * GUDANG tidak menerima harga apa pun. Satu pintu untuk semua endpoint, termasuk yang baru. */
@Injectable()
export class HidePricesInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();
    const role = context.switchToHttp().getRequest().user?.role;
    return role === 'gudang' ? next.handle().pipe(map(hidePrices)) : next.handle();
  }
}
