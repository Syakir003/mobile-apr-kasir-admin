import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

// Admin-only — sama pembatasan kayak app mobile ("audit_logs dibuka BACA
// untuk admin" di migrasi Supabase-nya). Log audit isinya jejak aksi semua
// role (termasuk kasir/teknisi), jadi gak dibuka ke role selain admin.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  findAll(@Query() query: AuditLogQueryDto) {
    return this.auditLogs.findAll(query);
  }
}
