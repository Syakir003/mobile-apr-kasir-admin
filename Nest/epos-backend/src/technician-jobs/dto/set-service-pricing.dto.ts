import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Satu baris jasa: dari katalog (serviceId, harga bebas diubah) atau jasa bebas (name wajib). */
export class ServicePricingLineDto {
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsNumber() @Min(0.01) qty: number;
  // 0 diperbolehkan = servis gratis/garansi, harus ditulis eksplisit.
  @IsNumber() @Min(0) unitPrice: number;
}

export class SetServicePricingDto {
  @ValidateNested({ each: true })
  @Type(() => ServicePricingLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  lines: ServicePricingLineDto[];
}
