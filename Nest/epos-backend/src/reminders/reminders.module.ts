import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { ServiceScheduleService } from './service-schedule.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsappModule],
  controllers: [RemindersController],
  providers: [RemindersService, ServiceScheduleService],
  // Dipakai TechnicianJobsModule — approveComplete() manggil
  // resolveIntervalDaysTx()/enqueueJobCompleteMessageTx() buat pesan
  // "selesai servis" + jadwal siklus berikutnya.
  exports: [RemindersService],
})
export class RemindersModule {}
