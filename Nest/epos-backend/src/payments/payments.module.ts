import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { ShiftsModule } from '../shifts/shifts.module';

@Module({
  imports: [RealtimeModule, ShiftsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
