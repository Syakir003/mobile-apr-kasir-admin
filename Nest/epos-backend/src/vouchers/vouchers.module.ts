import { Module } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { VouchersController } from './vouchers.controller';

@Module({
  controllers: [VouchersController],
  providers: [VouchersService],
  exports: [VouchersService], // dipakai PosService (checkout) buat lockAndValidateClaim
})
export class VouchersModule {}
