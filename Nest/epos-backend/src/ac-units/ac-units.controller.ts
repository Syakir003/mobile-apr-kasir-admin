import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AcUnitsService } from './ac-units.service';
import { UpdateAcUnitDto } from './dto/update-ac-unit.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ac-units')
export class AcUnitsController {
  constructor(private readonly acUnits: AcUnitsService) {}

  @Roles('admin', 'kasir', 'teknisi')
  @Get('lookup/:barcodeValue')
  lookup(@Param('barcodeValue') barcodeValue: string) {
    return this.acUnits.lookupByBarcode(barcodeValue);
  }

  /** Detail unit AC + riwayat servis by id — dipakai halaman Member. */
  @Roles('admin', 'kasir', 'teknisi')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.acUnits.findOne(id);
  }

  // Admin-only — sama pembatasan kayak edit master data produk/sparepart/
  // jasa lain (lihat komentar AcUnitsService.update).
  @Roles('admin')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAcUnitDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.acUnits.update(id, dto, user.sub);
  }
}
