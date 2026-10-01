import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Payload RPC create_service_order (migrasi Supabase 0013): order servis
 * manual multi-unit untuk member yang sudah ada — dipakai app mobile.
 * Beda dari ServiceIntakeDto (web) yang 1 unit per order + bisa member/unit baru. */
export class CreateServiceOrderDto {
  @IsString() @IsNotEmpty() memberId: string;
  @IsIn(['service', 'maintenance', 'cuci']) type: 'service' | 'maintenance' | 'cuci';
  @IsOptional() @IsString() technicianId?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsDateString() scheduledDate?: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) unitIds: string[];
}
