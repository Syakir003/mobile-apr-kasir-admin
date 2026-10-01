import { IsNotEmpty, IsString } from 'class-validator';

export class ScanUnitDto {
  @IsString() @IsNotEmpty() invoiceId: string;
  @IsString() @IsNotEmpty() qrToken: string;
}
