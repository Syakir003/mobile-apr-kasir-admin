import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateServiceDto {
  @IsString() name: string;
  // `category` menentukan jenis job servis di checkout (service_job_type()) —
  // wajib, kolomnya NOT NULL tanpa default di DB (schema Supabase).
  @IsString() category: string;
  @IsInt() @Min(0) basePrice: number;
  @IsOptional() @IsInt() durationMinutes?: number;
  @IsOptional() @IsString() description?: string;
}
