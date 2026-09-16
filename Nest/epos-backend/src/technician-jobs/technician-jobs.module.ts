import { Module } from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';
import { TechnicianJobsController } from './technician-jobs.controller';
import { OfflineSyncService } from './offline-sync.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { MaterialRequestsModule } from '../material-requests/material-requests.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemindersModule } from '../reminders/reminders.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  // Siklus 9 — MaterialRequestsModule diimport biar OfflineSyncService bisa
  // inject MaterialRequestsService (dipakai action 'material_add'). Aman,
  // gak ada circular dependency: MaterialRequestsModule sendiri gak pernah
  // import balik TechnicianJobsModule. NotificationsModule ditambah Siklus
  // Notifikasi Push — dipakai TechnicianJobsController.assign() buat
  // notify() teknisi yang baru ditugaskan. RemindersModule+WhatsappModule
  // ditambah Siklus WA/Fonnte — dipakai approveComplete() buat resolusi
  // siklus servis berikutnya + kirim pesan "selesai servis" otomatis.
  imports: [RealtimeModule, MaterialRequestsModule, NotificationsModule, RemindersModule, WhatsappModule],
  controllers: [TechnicianJobsController],
  providers: [TechnicianJobsService, OfflineSyncService],
  exports: [TechnicianJobsService],
})
export class TechnicianJobsModule {}
