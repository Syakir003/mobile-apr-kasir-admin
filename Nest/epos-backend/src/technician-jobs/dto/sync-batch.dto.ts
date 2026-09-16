import { Type } from 'class-transformer';
import { ArrayMinSize, ValidateNested } from 'class-validator';
import { SyncActionDto } from './sync-action.dto';

export class SyncBatchDto {
  @ValidateNested({ each: true })
  @Type(() => SyncActionDto)
  @ArrayMinSize(1)
  actions: SyncActionDto[];
}
