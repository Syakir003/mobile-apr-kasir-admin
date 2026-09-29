import { Module } from '@nestjs/common';
import { PosService } from './pos.service';
import { PosController } from './pos.controller';
import { AcUnitsModule } from '../ac-units/ac-units.module';
import { TechnicianJobsModule } from '../technician-jobs/technician-jobs.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { VouchersModule } from '../vouchers/vouchers.module';

@Module({
  imports: [AcUnitsModule, TechnicianJobsModule, RealtimeModule, VouchersModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
