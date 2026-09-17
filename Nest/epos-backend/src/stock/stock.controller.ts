import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { StockService } from './stock.service';
import { StockInDto } from './dto/stock-in.dto';
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

  @Get('movements')
  findMovements(@Query() query: StockMovementsQueryDto) {
    return this.stockService.findMovements(query);
  }
}
