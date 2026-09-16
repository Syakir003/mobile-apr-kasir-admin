import { Module } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';

// PrismaModule & CommonModule (StockLockingService) sudah @Global(), gak perlu di-import di sini.
@Module({
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
