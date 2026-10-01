import { Module } from '@nestjs/common';
import { KasirScanService } from './kasir-scan.service';
import { KasirScanController } from './kasir-scan.controller';

@Module({
  controllers: [KasirScanController],
  providers: [KasirScanService],
})
export class KasirScanModule {}
