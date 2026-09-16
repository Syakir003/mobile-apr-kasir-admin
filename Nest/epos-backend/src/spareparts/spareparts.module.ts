import { Module } from '@nestjs/common';
import { SparepartsService } from './spareparts.service';
import { SparepartsController } from './spareparts.controller';

@Module({
  controllers: [SparepartsController],
  providers: [SparepartsService],
  exports: [SparepartsService],
})
export class SparepartsModule {}
