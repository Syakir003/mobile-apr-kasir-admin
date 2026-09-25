import { IsIn, IsNumber, IsOptional, IsString, IsUUID, NotEquals } from 'class-validator';
import { IsQtyValidForKind } from './qty-by-kind.validator';

/**
 * Payload RPC `adjust_stock` apa adanya (`backend/supabase/migrations/
 * 20260719000016_stock_manual.sql`) — penyesuaian stok manual dengan tanda
 * bebas (+/-), BEDA dari `StockInDto` (cuma nambah, wajib buyPrice/sellPrice
 * batch baru) dan `StockOpnameDto` (set ke angka fisik absolut). Endpoint ini
 * dijembatani lewat `SupabaseRpcService` (masa transisi, lihat komentarnya),
 * bukan diport ulang ke Prisma — perilakunya HARUS identik dengan RPC lama
 * yang selama ini dipanggil langsung dari mobile.
 */
export class AdjustStockDto {
  @IsIn(['product', 'sparepart'])
  itemKind: 'product' | 'sparepart';

  @IsUUID()
  refId: string;

  // Bertanda: positif = masuk, negatif = keluar. RPC menolak 0 dan (untuk
  // produk) pecahan — lihat IsQtyValidForKind.
  @IsNumber()
  @NotEquals(0)
  @IsQtyValidForKind('itemKind')
  qtyChange: number;

  // 'penjualan'/'pemakaian_servis' SENGAJA tidak masuk di sini — itu alasan
  // otomatis milik sistem (checkout/pemakaian material), RPC menolaknya
  // untuk endpoint manual ini juga.
  @IsIn(['pembelian', 'koreksi', 'retur', 'rusak'])
  reason: 'pembelian' | 'koreksi' | 'retur' | 'rusak';

  @IsOptional()
  @IsString()
  note?: string;
}
