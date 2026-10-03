import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { DateRangeDto } from './dto/date-range.dto';
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';
import { parseDateRange } from './reports.util';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles('admin')
  @Get('sales')
  sales(@Query() query: DateRangeDto) {
    const { start, end } = parseDateRange(query.from, query.to);
    return this.reports.sales(start, end);
  }

  @Roles('admin')
  @Get('service')
  service(@Query() query: DateRangeDto) {
    const { start, end } = parseDateRange(query.from, query.to);
    return this.reports.service(start, end);
  }

  @Roles('admin')
  @Get('profit-loss')
  profitLoss(@Query() query: DateRangeDto) {
    const { start, end } = parseDateRange(query.from, query.to);
    return this.reports.profitLoss(start, end);
  }

  // Admin + gudang. Gudang TIDAK boleh lihat angka keuangan (modal/omzet/untung)
  // — dibuang di sini, bukan disembunyikan di FE.
  @Roles('admin', 'gudang')
  @Get('stock-movements')
  async stockMovements(@Query() query: StockMovementsQueryDto, @CurrentUser() user: CurrentUserPayload) {
    const { start, end } = parseDateRange(query.from, query.to);
    const report = await this.reports.stockMovements(start, end, {
      kind: query.kind,
      refId: query.refId,
      category: query.category,
    });
    if (user.role === 'admin') return report;
    return {
      items: report.items.map(({ modalTersisa, omzetTerjual, untungTerjual, ...row }) => row),
    };
  }
}
