import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateVoucherCampaignDto {
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['percentage', 'nominal']) discountType: 'percentage' | 'nominal';
  @IsNumber() @Min(0.01) discountValue: number;
  // null/kosong = berlaku semua kategori produk.
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsBoolean() firstPurchaseOnly?: boolean;
  @IsOptional() @IsString() termsAndConditions?: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
}
