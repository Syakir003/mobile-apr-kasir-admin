import { Module } from '@nestjs/common';
import { WaOutboxController, WhatsappLogsController } from './wa-outbox.controller';
import { WaOutboxService } from './wa-outbox.service';

@Module({
  controllers: [WaOutboxController, WhatsappLogsController],
  providers: [WaOutboxService],
})
export class WaOutboxModule {}
