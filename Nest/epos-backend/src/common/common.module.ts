import { Global, Module } from '@nestjs/common';
import { StockLockingService } from './services/stock-locking.service';
import { RateLimitService } from './services/rate-limit.service';

@Global()
@Module({
  // RateLimitService WAJIB singleton se-aplikasi (state-nya in-memory) —
  // makanya ditaruh di CommonModule yang @Global, bukan di-provide ulang di
  // tiap module yang butuh. Kalau di-provide ulang, tiap module dapet
  // instance sendiri dan hitungannya kepecah.
  providers: [StockLockingService, RateLimitService],
  exports: [StockLockingService, RateLimitService],
})
export class CommonModule {}
