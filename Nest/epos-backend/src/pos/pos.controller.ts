import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PosService } from './pos.service';
import { CheckoutDto } from './dto/checkout.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pos')
export class PosController {
  constructor(
    private readonly posService: PosService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
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
      // Gudang: ada unit AC terjual yang perlu disiapkan/diserahkan; admin+gudang:
      // cek sparepart yang stoknya jadi menipis. Fire-and-forget (gak ngeblok kasir).
      const unitQty = dto.items.filter((i) => i.kind === 'product').reduce((a, i) => a + i.qty, 0);
      if (unitQty > 0) {
        void this.notifications.notifyRoles(['gudang'], {
          title: 'Penjualan Baru — Siapkan Unit',
          body: `Invoice ${result.invoiceNumber}: ${unitQty} unit AC perlu disiapkan.`,
          type: 'penjualan_baru',
          target: result.invoiceId,
        });
      }
      void this.notifications.notifyLowStock(dto.items.filter((i) => i.kind === 'sparepart').map((i) => i.refId));
    }
    return result;
  }
}
