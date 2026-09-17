import { IsNotEmpty, IsString } from 'class-validator';

/** Wajib diisi Admin saat mengembalikan job dari menunggu_review ke
 * sedang_dikerjakan — supaya teknisi tau apa yang kurang. */
export class SendBackDto {
  @IsString() @IsNotEmpty() note: string;
}
