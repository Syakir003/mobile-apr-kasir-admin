import {
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsQtyValidForKind } from './qty-by-kind.validator';

export class StockInRollDto {
  // Panjang 1 gulungan (meter, atau satuan sparepart itu). Boleh pecahan
  // (maks 2 desimal, sama presisi DECIMAL(10,2) kolom item_costs.stock).
  @IsNumber()
  @Min(0.01)
  length: number;
}

export class StockInDto {
  @IsIn(['product', 'sparepart'])
  kind: 'product' | 'sparepart';

  @IsString()
  @IsNotEmpty()
  refId: string;

  // Siklus sparepart-per-gulungan (2026-09-23) — `qty` sekarang OPSIONAL di
  // level DTO. Wajib-tidaknya tergantung KOMBINASI kind + (buat sparepart)
  // Sparepart.batchTracked, yang cuma bisa dicek dengan query DB — gak bisa
  // divalidasi class-validator murni (beda dari @ValidateIf yang cuma bisa
  // liat field SEKELAS, gak bisa nyambung ke DB). Makanya requiredness-nya
  // dicek MANUAL di StockService.stockIn:
  //   - kind='product'            -> qty WAJIB (dicek service, BadRequestException kalau kosong)
  //   - kind='sparepart', flat    -> qty WAJIB, `rolls` HARUS kosong
  //   - kind='sparepart', batchTracked -> `rolls` WAJIB (min 1), qty diabaikan
  // Min(0) (bukan 0.01): mode pairMode='lengkap' BOLEH Indoor 0 (kiriman
  // Outdoor doang, Paket AC Split 2026-09-30). Semua mode lain tetap WAJIB
  // > 0 — dicek manual di StockService.stockIn.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @IsQtyValidForKind('kind')
  qty?: number;

  // BARU — cuma dipakai kind='sparepart' DENGAN Sparepart.batchTracked=true.
  // Tiap elemen = 1 gulungan baru yang masuk hari ini, panjangnya BOLEH
  // beda-beda per gulungan (gak ada default tersimpan) — SATU buyPrice di
  // bawah berlaku buat SEMUA gulungan dalam 1 barang-masuk ini (admin input
  // 1 nota, harga modal biasanya sama per nota).
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StockInRollDto)
  @ArrayMinSize(1)
  rolls?: StockInRollDto[];

  @IsNumber()
  @Min(0)
  buyPrice: number;

  // Siklus harga-seragam (2026-09-22) — sellPrice DIHAPUS dari sini. Harga
  // jual produk sekarang SATU angka seragam di Product.sellPrice, diatur
  // lewat Master Data Produk (create/update), BUKAN per-batch pas barang
  // masuk lagi. Warning "jual di bawah modal" pas barang masuk (StockService
  // .stockIn) sekarang banding buyPrice batch baru INI ke Product.sellPrice
  // yang UDAH ADA.

  // Opsional, catatan asal barang — cuma dipakai kalau kind='product' atau
  // kind='sparepart' batchTracked (bikin batch baru, punya konsep supplier
  // per-kedatangan). Sparepart flat gak pakai field ini (perilaku lama).
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

  // BARU (Point 2, 2026-09-23) — mode pairing AC Indoor/Outdoor. Default
  // (gak dikirim / 'tunggal') = perilaku lama persis, gak ada pairing sama
  // sekali. 'lengkap' bikin DUA batch sekaligus dalam SATU panggilan ini —
  // `refId` di atas SELALU dipakai sebagai id Product INDOOR, `outdoorRefId`
  // di bawah SELALU Outdoor-nya (gak ada logic nebak arah — satu-satunya
  // entry point toggle ini di frontend adalah dari produk Indoor, lihat
  // stock-client.tsx). Modal (`buyPrice` di atas) SELALU ke sisi Indoor;
  // Outdoor otomatis dapet buyPrice 0 (record-only, gak pernah kena warning
  // "di bawah modal").
  @IsOptional()
  @IsIn(['tunggal', 'lengkap'])
  pairMode?: 'tunggal' | 'lengkap';

  // Wajib diisi (divalidasi manual di StockService.stockIn, bukan di sini —
  // sama pola kayak requiredness qty/rolls) kalau pairMode='lengkap'.
  @IsOptional() @IsString() outdoorRefId?: string;

  // BARU (Paket AC Split, 2026-09-30) — jumlah unit OUTDOOR di barang masuk
  // paket, boleh BEDA dari `qty` (= jumlah Indoor), mis. kiriman Indoor 10
  // tapi Outdoor cuma 8. Boleh 0 (cuma Indoor yang dateng). Gak dikirim =
  // sama dengan `qty` (perilaku lama halaman /stock yang cuma kirim 1 qty).
  // `buyPrice` di atas tetap SATU angka = modal PAKET (Indoor + Outdoor),
  // nempel di batch Indoor (Outdoor Rp0) — lihat StockService.stockIn.
  @IsOptional() @IsInt() @Min(0) outdoorQty?: number;
}
