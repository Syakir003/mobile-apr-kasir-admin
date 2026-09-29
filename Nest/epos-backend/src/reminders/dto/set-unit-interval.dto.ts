import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

/** Port payload RPC set_unit_service_interval. intervalDays gak dikirim =
 * hapus override (unit balik ikut siklus default per jenis job). */
export class SetUnitIntervalDto {
  @IsString() @IsNotEmpty() unitId: string;
  @IsOptional() @IsInt() @Min(7) @Max(730) intervalDays?: number;
}
