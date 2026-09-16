import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecordPaymentDto {
  @IsIn(['tunai', 'transfer', 'qris', 'ewallet']) method: 'tunai' | 'transfer' | 'qris' | 'ewallet';
  @IsInt() @Min(1) amount: number;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() proofUrl?: string;
}
