import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { SystemResetService } from './system-reset.service';
import { ResetDatabaseDto } from './dto/reset-database.dto';

// Admin-only di 2 lapis: proxy.ts (frontend, ROLE_PREFIXES '/pengaturan')
// nolak non-admin sebelum halaman render sama sekali, DAN guard di sini
// (backend) — jangan pernah andelin cuma salah satu (defense in depth,
// endpoint ini bisa dipanggil langsung lewat Postman/curl).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('system-reset')
export class SystemResetController {
  constructor(private readonly service: SystemResetService) {}

  @Post()
  reset(@Body() dto: ResetDatabaseDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.reset(dto, user.sub);
  }
}
