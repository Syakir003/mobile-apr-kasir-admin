import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Wajib diisi Admin saat mengembalikan job dari menunggu_review ke
 * sedang_dikerjakan — supaya teknisi tau apa yang kurang. */
export class SendBackDto {
  @IsString() @IsNotEmpty() note: string;

  /** Servis banyak AC: kembalikan SEMUA unit (job) order ini yang menunggu review sekaligus. */
  @IsOptional() @IsBoolean() allInOrder?: boolean;
}
