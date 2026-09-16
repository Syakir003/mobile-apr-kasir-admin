import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { MaterialRequestItemDto } from './create-material-request.dto';

export class DecideMaterialRequestDto {
  @IsIn(['approve', 'revise', 'reject']) decision: 'approve' | 'revise' | 'reject';
  @IsOptional() @IsString() decisionNote?: string;

  // Wajib diisi kalau decision = 'revise' (daftar item pengganti).
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MaterialRequestItemDto)
  items?: MaterialRequestItemDto[];
}
