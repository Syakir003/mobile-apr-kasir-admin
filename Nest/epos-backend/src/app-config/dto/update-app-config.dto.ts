import { IsString } from 'class-validator';

export class UpdateAppConfigDto {
  @IsString() value: string;
}
