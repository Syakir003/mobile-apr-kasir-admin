import { IsNotEmpty, IsString } from 'class-validator';

export class ManualFulfillDto {
  @IsString() @IsNotEmpty() invoiceId: string;
  @IsString() @IsNotEmpty() refId: string;
}
