import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { KasirScanService } from './kasir-scan.service';
import { ScanUnitDto } from './dto/scan-unit.dto';
import { ManualFulfillDto } from './dto/manual-fulfill.dto';

// Admin + kasir — sama pembatasan kayak checkout POS (StockController/
// stock-in tetap admin-only, tapi ngeluarin barang abis invoice terbit ini
// pekerjaan kasir/gudang sehari-hari).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'kasir')
@Controller('kasir-scan')
export class KasirScanController {
  constructor(private readonly kasirScan: KasirScanService) {}

  @Get('pending')
  listPending() {
    return this.kasirScan.listPending();
  }

  @Get('invoices/:invoiceId')
  getInvoice(@Param('invoiceId') invoiceId: string) {
    return this.kasirScan.getInvoiceFulfillment(invoiceId);
  }

  @Post('scan')
  scan(@Body() dto: ScanUnitDto, @CurrentUser() user: CurrentUserPayload) {
    return this.kasirScan.scanUnit(dto, user.sub);
  }

  @Post('manual-fulfill')
  manualFulfill(@Body() dto: ManualFulfillDto, @CurrentUser() user: CurrentUserPayload) {
    return this.kasirScan.manualFulfill(dto, user.sub);
  }
}
