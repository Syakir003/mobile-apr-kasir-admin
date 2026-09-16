import { IsBoolean } from 'class-validator';

export class SetWaOptOutDto {
  @IsBoolean() optOut!: boolean;
}
