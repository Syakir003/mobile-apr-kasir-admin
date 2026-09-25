import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Payload RPC `set_unit_service_interval` apa adanya (admin). Tanpa
 * `intervalDays` = hapus override, unit kembali ikut default per jenis job. */
export class SetUnitIntervalDto {
  @IsUUID()
  unitId: string;

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(730)
  intervalDays?: number;
}
