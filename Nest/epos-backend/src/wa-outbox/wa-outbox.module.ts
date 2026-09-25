import { Module } from '@nestjs/common';
import { WaOutboxController } from './wa-outbox.controller';
import { WaOutboxService } from './wa-outbox.service';

@Module({
  controllers: [WaOutboxController],
  providers: [WaOutboxService],
})
export class WaOutboxModule {}
