import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AcUnitsService } from './ac-units.service';
import { UpdateAcUnitDto } from './dto/update-ac-unit.dto';
import { CompleteAcUnitDataDto } from './dto/complete-ac-unit-data.dto';
import { SubmitCorrectionDto } from './dto/submit-correction.dto';
import { AcUnitCorrectionsService } from './ac-unit-corrections.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ac-units')
export class AcUnitsController {
  constructor(
    private readonly acUnits: AcUnitsService,
    private readonly corrections: AcUnitCorrectionsService,
  ) {}

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

  /** Melengkapi data unit 'menunggu_data' (hasil Input Data Lampau mode "QR dulu"). */
  @Roles('admin', 'teknisi')
  @Post(':id/complete-data')
  completeData(
    @Param('id') id: string,
    @Body() dto: CompleteAcUnitDataDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.acUnits.completeData(id, dto, user.sub);
  }

  /** Teknisi mengajukan koreksi data unit aktif — admin yang menyetujui. */
  @Roles('teknisi')
  @Post(':id/corrections')
  submitCorrection(
    @Param('id') id: string,
    @Body() dto: SubmitCorrectionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.corrections.submit(id, dto, user.sub);
  }

  @Roles('admin', 'teknisi')
  @Get(':id/corrections/pending')
  pendingCorrection(@Param('id') id: string) {
    return this.corrections.pendingForUnit(id);
  }
}
