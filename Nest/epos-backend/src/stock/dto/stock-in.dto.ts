import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsQtyValidForKind } from './qty-by-kind.validator';

export class StockInDto {
  @IsIn(['product', 'sparepart'])
  kind: 'product' | 'sparepart';

  @IsString()
  @IsNotEmpty()
  refId: string;

  @IsNumber()
  @Min(0.01)
  @IsQtyValidForKind('kind')
  qty: number;

  @IsNumber()
  @Min(0)
  buyPrice: number;

  // Wajib diisi kalau kind='product' — harga jual BATCH baru ini. Dibanding-
  // kan ke buyPrice: kalau <= buyPrice, backend balikin peringatan dulu
  // (lihat StockService.stockIn), gak langsung disimpan.
  @ValidateIf((o: StockInDto) => o.kind === 'product')
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  // Opsional, catatan asal barang — cuma dipakai kalau kind='product'.
  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // Dikirim ulang (true) setelah admin confirm peringatan "harga jual di
  // bawah/pas modal" pas input barang masuk produk baru.
  @IsOptional()
  @IsBoolean()
  confirmOverride?: boolean;
}
