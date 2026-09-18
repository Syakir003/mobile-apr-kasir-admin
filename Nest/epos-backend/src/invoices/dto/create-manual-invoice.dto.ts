import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Baris item transaksi manual — SENGAJA bebas ketik nama (bukan `refId` ke
 * katalog produk/sparepart kayak CheckoutItemDto) karena kegunaannya buat
 * input data transaksi LAMPAU (sebelum sistem ini ada), barangnya mungkin
 * udah gak ada lagi di master data sekarang / namanya udah beda.
 * `buyPrice` opsional — kalau diisi, kepake sebagai `buyPriceSnapshot` biar
 * laporan laba-rugi (ReportsService.profitLoss) tetap bisa itung margin
 * baris ini; kalau dikosongin HPP-nya otomatis 0 di laporan (konsisten
 * sama baris invoice lama lain yang emang gak punya data harga beli).
 */
export class ManualInvoiceItemDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() unit?: string;
  @IsNumber() @Min(0.01) qty: number;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsNumber() @Min(0) buyPrice?: number;
}

/**
 * Data member BARU — dipakai kalau pelanggan transaksi lama ini belum
 * tercatat sebagai member sama sekali. Lewat MembersService.findOrCreate
 * yang SAMA dipakai PosService.checkout (dedupe by phone, advisory lock),
 * jadi kalau nomor HP-nya ternyata udah ada member existing-nya, otomatis
 * nyambung ke situ, bukan bikin duplikat.
 */
export class ManualInvoiceNewMemberDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() phone: string;
  @IsOptional() @IsString() address?: string;
}

export class CreateManualInvoiceDto {
  // Tanggal transaksi ASLINYA (bukan tanggal input hari ini) — format
  // "YYYY-MM-DD". Dipakai sebagai `createdAt` invoice (jam dipatok siang
  // WIB, lihat InvoicesService.createManual) SEKALIGUS bagian nomor invoice
  // (INV-<tanggal ini>-xxxx), biar data lampau ini masuk laporan di hari
  // yang bener, bukan numpuk di laporan hari ini.
  @IsDateString() date: string;

  // WAJIB isi SALAH SATU dari dua ini (dicek manual di service, class-
  // validator gak punya "exactly one of" built-in) — member existing
  // (dicari lewat halaman Member) ATAU data member baru.
  @IsOptional() @IsString() memberId?: string;
  @IsOptional() @ValidateNested() @Type(() => ManualInvoiceNewMemberDto) newMember?: ManualInvoiceNewMemberDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ManualInvoiceItemDto)
  items: ManualInvoiceItemDto[];

  // Diskon level-invoice (di luar diskon per-baris) — sama makna kayak
  // CheckoutDto.discount.
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsNumber() @Min(0) transportFee?: number;

  // Berapa yang UDAH dibayar dari transaksi lama ini — status invoice
  // (lunas/dp/kurang_bayar/belum_dibayar) DIHITUNG dari sini pakai
  // computeInvoiceStatus() yang sama dipakai seluruh sistem, BUKAN dipilih
  // manual dari dropdown — supaya gak ada kemungkinan admin milih status
  // yang gak nyambung sama nominal dibayarnya (sama kelas bug kayak S-9 di
  // audit: status invoice desync dari total_paid).
  @IsOptional() @IsNumber() @Min(0) totalPaid?: number;

  @IsOptional() @IsString() notes?: string;
}
