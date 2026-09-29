import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { AC_UNIT_STATUSES } from './update-ac-unit.dto';

/** Tambah unit AC ke member dari app mobile (form unit di detail member).
 * barcodeValue dibikin server (format ACUNIT-YYYYMMDD-NNNN), bukan dari client. */
export class CreateAcUnitDto {
  @IsString() @IsNotEmpty() memberId: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsIn(AC_UNIT_STATUSES) status?: (typeof AC_UNIT_STATUSES)[number];
}
