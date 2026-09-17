import { Module } from '@nestjs/common';
import { MaterialRequestsService } from './material-requests.service';
import { MaterialRequestsController } from './material-requests.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [RealtimeModule, NotificationsModule],
  controllers: [MaterialRequestsController],
  providers: [MaterialRequestsService],
  // Siklus 9 — di-export biar OfflineSyncService (technician-jobs module)
  // bisa reuse method create() yang sama persis, bukan nulis ulang logic
  // pricing/pengajuan material di tempat lain.
  exports: [MaterialRequestsService],
})
export class MaterialRequestsModule {}
