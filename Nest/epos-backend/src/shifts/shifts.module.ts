import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

// PrismaModule sudah @Global(), gak perlu di-import di sini.
@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService], // dipakai PaymentsService buat cari shift aktif kasir
})
export class ShiftsModule {}
