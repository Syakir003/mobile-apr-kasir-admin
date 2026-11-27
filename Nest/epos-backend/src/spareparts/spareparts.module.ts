import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { SparepartsService } from './spareparts.service';
import { SparepartsController } from './spareparts.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [SparepartsController],
  providers: [SparepartsService],
  exports: [SparepartsService],
})
export class SparepartsModule {}
