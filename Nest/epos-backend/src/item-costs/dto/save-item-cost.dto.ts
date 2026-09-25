import { IsInt, Min } from 'class-validator';

export class SaveItemCostDto {
  @IsInt() @Min(0) buyPrice: number;
}
