import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecordPaymentDto {
  // 'debit' ditambah buat POS pay-immediately (prototype punya chip Tunai/
  // QRIS/Debit/Transfer) — kolom Prisma-nya `method String` polos, bukan
  // enum DB, jadi nambah value baru di sini aman, gak perlu migration.
  @IsIn(['tunai', 'transfer', 'qris', 'ewallet', 'debit'])
  method: 'tunai' | 'transfer' | 'qris' | 'ewallet' | 'debit';
  @IsInt() @Min(1) amount: number;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() proofUrl?: string;
}
