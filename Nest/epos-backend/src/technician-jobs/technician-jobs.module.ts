import { Module } from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';
import { TechnicianJobsController } from './technician-jobs.controller';
import { OfflineSyncService } from './offline-sync.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { MaterialRequestsModule } from '../material-requests/material-requests.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // Siklus 9 — MaterialRequestsModule diimport biar OfflineSyncService bisa
  // inject MaterialRequestsService (dipakai action 'material_add'). Aman,
  // gak ada circular dependency: MaterialRequestsModule sendiri gak pernah
  // import balik TechnicianJobsModule. NotificationsModule ditambah Siklus
  // Notifikasi Push — dipakai TechnicianJobsController.assign() buat
  // notify() teknisi yang baru ditugaskan. approveComplete() sekarang
  // delegasi ke SupabaseRpcService (PrismaModule, @Global()) jadi tidak ada
  // lagi RemindersModule/WhatsappModule di sini.
  imports: [RealtimeModule, MaterialRequestsModule, NotificationsModule],
  controllers: [TechnicianJobsController],
  providers: [TechnicianJobsService, OfflineSyncService],
  exports: [TechnicianJobsService],
})
export class TechnicianJobsModule {}
