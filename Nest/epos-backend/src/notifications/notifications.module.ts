import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { FirebaseAdminService } from './firebase-admin.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, FirebaseAdminService],
  // Di-export biar service lain (technician-jobs, material-requests, dst)
  // bisa inject NotificationsService dan panggil notify() langsung setelah
  // aksi bisnisnya berhasil — sama pola kayak MaterialRequestsService yang
  // di-export dari MaterialRequestsModule.
  exports: [NotificationsService],
})
export class NotificationsModule {}
