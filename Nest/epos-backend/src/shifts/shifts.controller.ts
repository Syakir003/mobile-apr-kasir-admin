import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ShiftsService } from './shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Roles('kasir')
  @Post('open')
  open(@Body() dto: OpenShiftDto, @CurrentUser() user: CurrentUserPayload) {
    return this.shiftsService.open(user.sub, dto.openingBalance);
  }

  // Ditambahkan buat frontend uji-coba: kasir cek shift-nya sendiri yang lagi
  // terbuka tanpa perlu simpan/ingat shiftId secara manual di client.
  @Roles('kasir')
  @Get('current')
  current(@CurrentUser() user: CurrentUserPayload) {
    return this.shiftsService.findMyOpenShift(user.sub);
  }

  @Roles('kasir')
  @Post(':id/close')
  close(
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.shiftsService.close(id, user.sub, dto.closingBalance, dto.notes);
  }

  // Tanpa @Roles() spesifik — semua role login boleh HIT endpoint ini, tapi
  // service yang gate: kasir cuma boleh liat shift-nya sendiri, admin boleh liat semua.
  @Get(':id/report')
  report(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.shiftsService.report(id, { sub: user.sub, role: user.role });
  }
}
