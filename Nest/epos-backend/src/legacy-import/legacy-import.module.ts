import { Module } from '@nestjs/common';
import { AcUnitsModule } from '../ac-units/ac-units.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { LegacyImportController } from './legacy-import.controller';
import { LegacyImportService } from './legacy-import.service';

@Module({
  imports: [AcUnitsModule, InvoicesModule],
  controllers: [LegacyImportController],
  providers: [LegacyImportService],
})
export class LegacyImportModule {}
