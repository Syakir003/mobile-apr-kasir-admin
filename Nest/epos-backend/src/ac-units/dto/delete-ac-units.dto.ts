import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/** Hapus beberapa unit AC sekaligus (POST /ac-units/delete, admin). Yang tidak boleh dihapus dilewati beserta alasannya. */
export class DeleteAcUnitsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Pilih minimal satu unit' })
  @ArrayMaxSize(200, { message: 'Maksimal 200 unit sekali hapus' })
  @IsString({ each: true })
  unitIds: string[];
}
