import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { InstallationPackageItemDto } from './create-installation-package.dto';

// PATCH parsial — semua field opsional. `items`, KALAU dikirim, me-REPLACE
// SEMUA item lama (delete semua item lama lalu insert ulang semuanya) —
// persis perilaku RPC save_installation_package versi lama, karena form
// admin ngirim seluruh daftar item tiap submit (bukan delta per-item).
// Kalau `items` gak dikirim di body, item yang sudah ada dibiarkan apa
// adanya.
export class UpdateInstallationPackageDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() active?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallationPackageItemDto)
  items?: InstallationPackageItemDto[];
}
