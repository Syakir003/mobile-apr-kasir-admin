import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

// Item dalam paket instalasi — port dari elemen `p_items` di RPC
// save_installation_package (pos_functions.sql). `sparepartId` opsional
// (paket bisa punya baris item yang murni jasa/biaya tambahan tanpa
// nyambung ke sparepart tertentu), sisanya wajib.
export class InstallationPackageItemDto {
  @IsOptional() @IsUUID() sparepartId?: string;
  @IsString() @IsNotEmpty() name: string;
  @IsNumber() @Min(0) qty: number;
  @IsString() @IsNotEmpty() unit: string;
  @IsOptional() @IsNumber() @Min(0) extraPricePerUnit?: number;
}

export class CreateInstallationPackageDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() active?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallationPackageItemDto)
  items: InstallationPackageItemDto[];
}
