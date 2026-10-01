import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { StockService } from './stock.service';
import { StockInDto } from './dto/stock-in.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StockOpnameDto } from './dto/stock-opname.dto';
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';

// Semua endpoint di sini admin-only — beda dari checkout (Siklus 1) yang admin+kasir boleh.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('in')
  stockIn(@Body() dto: StockInDto, @CurrentUser() user: CurrentUserPayload) {
    return this.stockService.stockIn(dto, user.sub);
  }

  @Post('opname')
  opname(@Body() dto: StockOpnameDto, @CurrentUser() user: CurrentUserPayload) {
    return this.stockService.opname(dto, user.sub);
  }

  /** Koreksi stok manual (rusak/retur/koreksi/pembelian) — app mobile. */
  @Post('adjust')
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: CurrentUserPayload) {
    return this.stockService.adjust(dto, user.sub);
  }

  @Get('movements')
  findMovements(@Query() query: StockMovementsQueryDto) {
    return this.stockService.findMovements(query);
  }

  // BARU (Siklus QR per-unit, 2026-09-30) — daftar unit fisik 1 batch, buat
  // halaman cetak/cetak-ulang label QR.
  @Get('batches/:itemCostId/units')
  findUnitsByBatch(@Param('itemCostId') itemCostId: string) {
    return this.stockService.findUnitsByBatch(itemCostId);
  }
}
