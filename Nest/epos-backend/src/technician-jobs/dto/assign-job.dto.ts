import { IsString, IsNotEmpty } from 'class-validator';

export class AssignJobDto {
  @IsString() @IsNotEmpty() technicianId: string;
}
