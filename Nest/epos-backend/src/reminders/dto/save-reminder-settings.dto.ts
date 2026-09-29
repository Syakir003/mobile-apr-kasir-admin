import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsString, Max, Min, ValidateNested } from 'class-validator';

class ReminderSettingEntryDto {
  @IsString() jobType!: string;
  @IsInt() @Min(7) @Max(730) intervalDays!: number;
  @IsBoolean() active!: boolean;
}

/** Simpan sekaligus (biasanya 2 baris: cuci & maintenance) — form frontend
 * nampilin keduanya di satu halaman, satu tombol "Simpan". */
export class SaveReminderSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderSettingEntryDto)
  settings!: ReminderSettingEntryDto[];
}
