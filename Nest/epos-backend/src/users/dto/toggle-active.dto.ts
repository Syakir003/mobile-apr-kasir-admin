import { IsBoolean } from 'class-validator';

export class ToggleActiveDto {
  @IsBoolean() active: boolean;
}
