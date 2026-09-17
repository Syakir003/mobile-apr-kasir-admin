import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WhatsappService } from './whatsapp.service';
import { WhatsappHistoryQueryDto } from './dto/whatsapp-history-query.dto';

/** Halaman "Riwayat WA" — gabungan padanan wa_history_screen.dart +
 * wa_outbox_screen.dart mobile (di sini gak perlu dipisah antrean/riwayat
 * lagi karena pengiriman sudah otomatis, bukan antrean yang nunggu admin
 * klik kirim manual). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('whatsapp-logs')
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Roles('admin', 'kasir')
  @Get()
  findAll(@Query() query: WhatsappHistoryQueryDto) {
    return this.whatsapp.history(query);
  }

  // Admin-only — retry pesan yang gagal terkirim (mis. Fonnte lagi down/nomor
  // sempat gak valid). Cuma bisa dipanggil utk baris berstatus 'gagal',
  // lihat WhatsappService.dispatch.
  @Roles('admin')
  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.whatsapp.retry(id);
  }
}
