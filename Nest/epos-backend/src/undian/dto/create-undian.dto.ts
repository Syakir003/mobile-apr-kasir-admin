import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class UndianCriteriaDto {
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
  @IsOptional() @IsBoolean() mustHaveAcPurchase?: boolean;
}

/** Payload RPC create_undian (migrasi Supabase 0028), dipakai app mobile. */
export class CreateUndianDto {
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @ValidateNested() @Type(() => UndianCriteriaDto) criteria?: UndianCriteriaDto;
  @IsInt() @Min(1) winnerCount: number;
  @IsIn(['persen', 'nominal']) discountType: 'persen' | 'nominal';
  @IsNumber() @Min(1) discountValue: number;
  @IsOptional() @IsNumber() @Min(1) maxDiscountCap?: number;
  @IsOptional() @IsNumber() @Min(0) minPurchase?: number;
  @IsInt() @Min(1) voucherValidDays: number;
}
