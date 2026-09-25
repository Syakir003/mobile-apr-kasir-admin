import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { WaOutboxService } from './wa-outbox.service';
import { CancelWaMessageDto, WaOutboxQueryDto } from './dto/wa-outbox.dto';

// Role = policy RLS "wa_outbox: baca admin/kasir" + cek di mark_wa_sent/
// cancel_wa_message. Teknisi ditolak 403 di sini (RPC-nya sendiri hanya
// raise 'Tidak diizinkan' yang akan jadi 400).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'kasir')
@Controller('wa-outbox')
export class WaOutboxController {
  constructor(private readonly waOutbox: WaOutboxService) {}

  @Get()
  queue(@Query() query: WaOutboxQueryDto) {
    return this.waOutbox.queue(query.status);
  }

  @Get('history')
  history() {
    return this.waOutbox.history();
  }

  @Post(':id/mark-sent')
  markSent(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.waOutbox.markSent(user, id);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelWaMessageDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.waOutbox.cancel(user, id, dto.reason);
  }
}
