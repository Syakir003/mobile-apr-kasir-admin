import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettlementsService } from './settlements.service';
import { FromPaperDto, RejectFieldPaymentDto, RepayDto, SettleDto } from './dto/settlement.dto';

/**
 * Setoran harian dan verifikasi pembayaran lapangan — HANYA admin (kasir tidak ikut memverifikasi uang teknisi).
 * Rute statis ('awaiting', 'from-paper', 'pending', 'repay', 'technician-cash') berbeda bentuk dengan rute ':id/...'
 * di FieldPaymentsController, jadi tidak bentrok.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller()
export class SettlementsController {
  constructor(
    private readonly settlements: SettlementsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // Bahan layar Setoran satu teknisi: tunai yang dipegang, total seharusnya, saldo, sparepart yang harus kembali.
  @Get('settlements/pending')
  pending(@Query('technicianId') technicianId: string, @Query('date') date?: string) {
    if (!technicianId) throw new BadRequestException('technicianId wajib diisi');
    return this.settlements.pending(technicianId, date || undefined);
  }

  @Post('settlements')
  async settle(@Body() dto: SettleDto, @CurrentUser() user: CurrentUserPayload) {
    const r = await this.settlements.settle(dto, user.sub);
    this.realtime.emitToAdmin('settlement.created', { settlementId: r.settlementId, technicianId: dto.technicianId });
    return r;
  }

  @Post('settlements/repay')
  repay(@Body() dto: RepayDto, @CurrentUser() user: CurrentUserPayload) {
    return this.settlements.repay(dto, user.sub);
  }

  @Get('settlements/technician-cash')
  technicianCash() {
    return this.settlements.technicianCash();
  }

  // Antrean pencocokan mutasi (non-tunai).
  @Get('field-payments/awaiting')
  awaiting() {
    return this.settlements.awaiting();
  }

  @Post('field-payments/from-paper')
  fromPaper(@Body() dto: FromPaperDto, @CurrentUser() user: CurrentUserPayload) {
    return this.settlements.fromPaper(dto, user.sub);
  }

  @Post('field-payments/:id/verify')
  verify(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.settlements.verify(id, user.sub);
  }

  @Post('field-payments/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectFieldPaymentDto, @CurrentUser() user: CurrentUserPayload) {
    return this.settlements.reject(id, dto.reason, user.sub);
  }
}
