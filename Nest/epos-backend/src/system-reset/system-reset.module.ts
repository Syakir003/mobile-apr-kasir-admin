import { Module } from '@nestjs/common';
import { SystemResetController } from './system-reset.controller';
import { SystemResetService } from './system-reset.service';

@Module({
  controllers: [SystemResetController],
  providers: [SystemResetService],
})
export class SystemResetModule {}
