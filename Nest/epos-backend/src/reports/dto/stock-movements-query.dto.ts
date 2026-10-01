import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

/** Query `GET /reports/stock-movements` (Point 4) — `from`/`to` WAJIB, sama
 * format & semantik (WIB-aware) kayak `DateRangeDto` yang dipakai 3 endpoint
 * reports lain (lihat `parseDateRange` di reports.util.ts). Filter item
 * SEMUA opsional — kosong = tampilin semua produk+sparepart aktif. */
export class StockMovementsQueryDto {
  @IsISO8601() from: string;
  @IsISO8601() to: string;

  @IsOptional() @IsIn(['product', 'sparepart']) kind?: 'product' | 'sparepart';
  @IsOptional() @IsString() refId?: string;
  @IsOptional() @IsString() category?: string;
}
