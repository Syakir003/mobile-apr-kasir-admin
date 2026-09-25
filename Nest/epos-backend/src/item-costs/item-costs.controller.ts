import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { COST_KINDS, ItemCostsService } from './item-costs.service';
import type { CostKind } from './item-costs.service';
import { SaveItemCostDto } from './dto/save-item-cost.dto';

// Admin-only — sama dengan RLS item_costs (baca/tulis/ubah admin, migrasi 0021):
// harga modal tak boleh sampai ke kasir/teknisi (bisa dipakai menghitung margin).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('item-costs')
export class ItemCostsController {
  constructor(private readonly itemCosts: ItemCostsService) {}

  @Get()
  findAll(@Query('kind', new ParseEnumPipe(COST_KINDS)) kind: CostKind) {
    return this.itemCosts.findAll(kind);
  }

  @Get(':kind/:refId')
  findOne(
    @Param('kind', new ParseEnumPipe(COST_KINDS)) kind: CostKind,
    @Param('refId', ParseUUIDPipe) refId: string,
  ) {
    return this.itemCosts.findOne(kind, refId);
  }

  @Put(':kind/:refId')
  save(
    @Param('kind', new ParseEnumPipe(COST_KINDS)) kind: CostKind,
    @Param('refId', ParseUUIDPipe) refId: string,
    @Body() dto: SaveItemCostDto,
  ) {
    return this.itemCosts.save(kind, refId, dto.buyPrice);
  }
}
