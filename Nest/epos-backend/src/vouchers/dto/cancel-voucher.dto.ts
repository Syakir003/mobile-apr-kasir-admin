import { IsOptional, IsString } from 'class-validator';

export class CancelVoucherDto {
  @IsOptional() @IsString() reason?: string;
}
