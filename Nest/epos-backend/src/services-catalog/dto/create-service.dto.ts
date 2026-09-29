import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateServiceDto {
  @IsString() name: string;
  @IsOptional() @IsString() category?: string;
  @IsNumber() @Min(0) basePrice: number;
  @IsOptional() @IsInt() durationMinutes?: number;
  @IsOptional() @IsString() description?: string;
}
