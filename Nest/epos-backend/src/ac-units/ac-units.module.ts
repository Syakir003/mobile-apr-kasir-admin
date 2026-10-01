import { Module } from '@nestjs/common';
import { AcUnitsService } from './ac-units.service';
import { AcUnitsController } from './ac-units.controller';
import { AcUnitAdminController } from './ac-unit-admin.controller';
import { AcUnitLabelsService } from './ac-unit-labels.service';
import { AcUnitCorrectionsService } from './ac-unit-corrections.service';

@Module({
  controllers: [AcUnitsController, AcUnitAdminController],
  providers: [AcUnitsService, AcUnitLabelsService, AcUnitCorrectionsService],
  exports: [AcUnitsService],
})
export class AcUnitsModule {}
