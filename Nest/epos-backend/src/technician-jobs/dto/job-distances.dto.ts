import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class JobDistancesDto {
  /** Id job yang jaraknya dihitung dari toko (urutan "Terdekat" di Antrian Servis). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @IsString({ each: true })
  jobIds: string[];
}
