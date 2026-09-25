import { Module } from '@nestjs/common';
import { PosService } from './pos.service';
import { PosController } from './pos.controller';

// PrismaModule (SupabaseRpcService) & RealtimeModule sudah @Global().
@Module({
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
