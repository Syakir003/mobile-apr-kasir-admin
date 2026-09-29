import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSparepartDto {
  @IsString() name: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() category?: string;
  @IsString() unit: string;
  @IsNumber() @Min(0) sellPrice: number;
  @IsNumber() @Min(0) stock: number;
  @IsOptional() @IsNumber() @Min(0) minStock?: number;
}
