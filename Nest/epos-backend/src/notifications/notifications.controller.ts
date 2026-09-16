import { Body, Controller, Delete, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { UnregisterDeviceTokenDto } from './dto/unregister-device-token.dto';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';

// Sengaja TANPA @Roles() di level manapun di sini — semua role login
// (admin/kasir/teknisi) punya notifikasi sendiri-sendiri, gak ada
// pembatasan role kayak /audit-logs. RolesGuard tetap dipasang (konsisten
// sama controller lain) tapi otomatis lolos semua role login kalau gak ada
// metadata @Roles (lihat RolesGuard.canActivate).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // Padanan register_device_token RPC (FcmService.start()/_register()).
  @Post('device-tokens')
  registerDeviceToken(
    @Body() dto: RegisterDeviceTokenDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.notifications.registerDeviceToken(user.sub, dto);
  }

  // Padanan unregister_device_token RPC (FcmService.stop(), dipanggil logout).
  @Delete('device-tokens')
  unregisterDeviceToken(
    @Body() dto: UnregisterDeviceTokenDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.notifications.unregisterDeviceToken(user.sub, dto.token);
  }

  // Padanan notificationsStreamProvider (list, di sini via REST+polling
  // atau socket 'notification.new' buat update instan — lihat RealtimeGateway).
  @Get('notifications')
  findAll(@Query() query: NotificationsQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.notifications.findAll(user.sub, query);
  }

  // Padanan unreadCountProvider (badge lonceng).
  @Get('notifications/unread-count')
  async unreadCount(@CurrentUser() user: CurrentUserPayload) {
    return { count: await this.notifications.unreadCount(user.sub) };
  }

  // Padanan mark_notifications_read RPC.
  @Patch('notifications/read')
  markRead(@Body() dto: MarkReadDto, @CurrentUser() user: CurrentUserPayload) {
    return this.notifications.markRead(user.sub, dto.notificationId);
  }
}
