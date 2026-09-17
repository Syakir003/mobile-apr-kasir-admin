import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PosService } from './pos.service';
import { CheckoutDto } from './dto/checkout.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pos')
export class PosController {
  constructor(
    private readonly posService: PosService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Roles('admin', 'kasir')
  @Post('checkout')
  async checkout(@Body() dto: CheckoutDto, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.posService.checkout(dto, user.sub);
    // Siklus batch-cost (2026-09): checkout bisa balik status
    // 'confirm_required' (belum ada transaksi/invoice yang kebuat, lihat
    // PosService.checkout) — jangan broadcast event 'transaction.created'
    // kalau belum ada transaksi beneran.
    if (result.status === 'ok') {
      this.realtime.emitToAdmin('transaction.created', result);
    }
    return result;
  }
}
