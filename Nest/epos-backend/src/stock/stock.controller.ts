import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { StockService } from './stock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockInDto } from './dto/stock-in.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StockOpnameDto } from './dto/stock-opname.dto';
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';

// Admin + gudang (staf stok). Beda dari checkout (Siklus 1) yang admin+kasir boleh.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'gudang')
@Controller('stock')
export class StockController {
  constructor(
    private readonly stockService: StockService,
    private readonly notifications: NotificationsService,
  ) {}

  @Post('in')
  stockIn(@Body() dto: StockInDto, @CurrentUser() user: CurrentUserPayload) {
    return this.stockService.stockIn(dto, user.sub);
  }

  @Post('opname')
  async opname(@Body() dto: StockOpnameDto, @CurrentUser() user: CurrentUserPayload) {
    const results = await this.stockService.opname(dto, user.sub);
    // Admin dikabari hasil opname (cuma kalau ada selisih) saat yang input
    // BUKAN admin sendiri (mis. gudang).
    const selisih = results.filter((r) => r.delta !== 0);
    if (selisih.length > 0 && user.role !== 'admin') {
      const top = selisih
        .slice(0, 3)
        .map((r) => `${r.name} ${r.delta > 0 ? '+' : ''}${r.delta}`)
        .join(', ');
      void this.notifications.notifyRoles(['admin'], {
        title: 'Hasil Opname Stok',
        body: `${selisih.length} dari ${results.length} item selisih: ${top}${selisih.length > 3 ? ', ...' : ''}`,
        type: 'opname_selesai',
      });
    }
    void this.notifications.notifyLowStock(dto.items.filter((i) => i.kind === 'sparepart').map((i) => i.refId));
    return results;
  }

  /** Koreksi stok manual (rusak/retur/koreksi/pembelian) — app mobile. */
  @Post('adjust')
  async adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.stockService.adjust(dto, user.sub);
    if (dto.itemKind === 'sparepart' && dto.qtyChange < 0) void this.notifications.notifyLowStock([dto.refId]);
    return result;
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
