import { IsString, IsNotEmpty } from 'class-validator';

export class StartJobDto {
  @IsString() @IsNotEmpty() scannedBarcode: string;
}
