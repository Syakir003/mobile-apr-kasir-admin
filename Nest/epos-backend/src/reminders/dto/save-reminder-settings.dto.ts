import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';

/** Payload RPC `save_reminder_settings` (satu baris). Batas nilai dijaga RPC. */
export class ReminderSettingDto {
  @IsString() jobType: string;
  @IsInt() intervalDays: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

/**
 * Satu baris (bentuk payload RPC) ATAU `{ settings: [...] }` (bentuk yang
 * dikirim web) — array dijalankan per item berurutan, sama seperti Flutter.
 */
export class SaveReminderSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReminderSettingDto)
  settings?: ReminderSettingDto[];

  @ValidateIf((o: SaveReminderSettingsDto) => !o.settings) @IsString() jobType?: string;
  @ValidateIf((o: SaveReminderSettingsDto) => !o.settings) @IsInt() intervalDays?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
