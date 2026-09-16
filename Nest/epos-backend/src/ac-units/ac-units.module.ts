import { Module } from '@nestjs/common';
import { AcUnitsService } from './ac-units.service';
import { AcUnitsController } from './ac-units.controller';

@Module({
  controllers: [AcUnitsController],
  providers: [AcUnitsService],
  exports: [AcUnitsService],
})
export class AcUnitsModule {}
