import { ArrayMinSize, IsArray, IsString } from 'class-validator';

/** Requirement eksplisit: penawaran voucher itu TARGETED ke member tertentu,
 * bukan broadcast massal — makanya wajib isi list memberIds sendiri, gak ada
 * mode "semua member". */
export class OfferCampaignDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) memberIds: string[];
}
