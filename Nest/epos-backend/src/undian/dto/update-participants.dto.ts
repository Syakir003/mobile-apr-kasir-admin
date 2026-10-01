import { IsArray, IsOptional, IsString } from 'class-validator';

/** Payload RPC update_undian_participants — undianId pindah ke path. */
export class UpdateParticipantsDto {
  @IsOptional() @IsArray() @IsString({ each: true }) add?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) remove?: string[];
}
