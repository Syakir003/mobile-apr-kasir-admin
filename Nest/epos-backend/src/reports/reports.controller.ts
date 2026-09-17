import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportsService } from './reports.service';
import { DateRangeDto } from './dto/date-range.dto';
import { parseDateRange } from './reports.util';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  sales(@Query() query: DateRangeDto) {
    const { start, end } = parseDateRange(query.from, query.to);
    return this.reports.sales(start, end);
  }

  @Get('service')
  service(@Query() query: DateRangeDto) {
    const { start, end } = parseDateRange(query.from, query.to);
    return this.reports.service(start, end);
  }

  @Get('profit-loss')
  profitLoss(@Query() query: DateRangeDto) {
    const { start, end } = parseDateRange(query.from, query.to);
    return this.reports.profitLoss(start, end);
  }
}
