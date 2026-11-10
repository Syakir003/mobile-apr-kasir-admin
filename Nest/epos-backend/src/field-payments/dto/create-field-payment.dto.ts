import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { FIELD_PAYMENT_METHODS, type FieldPaymentMethod } from '../field-payment.constants';

/** Body multipart `POST /technician-jobs/:jobId/field-payments` (field file bernama `proof`). */
export class CreateFieldPaymentDto {
  @IsIn(FIELD_PAYMENT_METHODS, { message: 'Metode bayar tidak valid' }) method: FieldPaymentMethod;
  // multipart mengirim string -> diubah ke angka.
  @Type(() => Number) @IsInt({ message: 'Nominal harus bilangan bulat rupiah' }) @Min(1, { message: 'Nominal minimal Rp 1' }) amount: number;
  // Wajib bila nominal < sisa tagihan (DP/sebagian); dicek di service.
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  // Kunci idempotensi dari klien (HP bisa mengirim ulang request yang sama): pembayaran yang sama tidak tercatat dua kali.
  @IsOptional() @IsString() @MaxLength(80) clientRef?: string;
}
