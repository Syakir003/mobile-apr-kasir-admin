import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, NotEquals } from 'class-validator';

export const ADJUST_REASONS = ['pembelian', 'koreksi', 'retur', 'rusak'] as const;

/** Payload RPC adjust_stock (dipakai app mobile). qtyChange boleh negatif
 * (keluar) / positif (masuk), gak boleh 0. itemCostId opsional: target
 * batch produk tertentu; kalau kosong, keluar = FIFO, masuk = batch terbaru. */
export class AdjustStockDto {
  @IsIn(['product', 'sparepart']) itemKind: 'product' | 'sparepart';
  @IsString() @IsNotEmpty() refId: string;
  @IsNumber() @NotEquals(0) qtyChange: number;
  @IsIn(ADJUST_REASONS) reason: (typeof ADJUST_REASONS)[number];
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() itemCostId?: string;
}
