import { Module } from '@nestjs/common';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersService } from './service-orders.service';
import { AcUnitsModule } from '../ac-units/ac-units.module';
import { TechnicianJobsModule } from '../technician-jobs/technician-jobs.module';

// MembersModule & RealtimeModule sengaja gak diimport eksplisit — keduanya
// @Global() (lihat members.module.ts / realtime.module.ts), otomatis
// ke-inject di mana aja tanpa perlu masuk ke `imports` module ini.
@Module({
  imports: [AcUnitsModule, TechnicianJobsModule],
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersService],
})
export class ServiceOrdersModule {}
