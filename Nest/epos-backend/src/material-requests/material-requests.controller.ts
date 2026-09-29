import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { MaterialRequestsService } from './material-requests.service';
import { CreateMaterialRequestDto } from './dto/create-material-request.dto';
import { DecideMaterialRequestDto } from './dto/decide-material-request.dto';
import { MaterialRequestQueryDto } from './dto/material-request-query.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class MaterialRequestsController {
  constructor(
    private readonly requests: MaterialRequestsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  // Halaman admin "Pengajuan Masuk" — admin-only (sama pembatasan kayak
  // Voucher/Audit), teknisi tetap lihat pengajuan MILIKNYA lewat GET
  // /technician-jobs/:id yang udah ada, gak perlu endpoint lintas-job ini.
  @Roles('admin')
  @Get('material-requests')
  findAll(@Query() query: MaterialRequestQueryDto) {
    return this.requests.findAll(query);
  }

  @Roles('admin', 'teknisi')
  @Post('technician-jobs/:jobId/materials')
  async create(
    @Param('jobId') jobId: string,
    @Body() dto: CreateMaterialRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.requests.create(jobId, dto, user.sub, user.role);
    this.realtime.emitToAdmin('material_request.created', { jobId, requestId: result.id });
    return result;
  }

  @Roles('admin')
  @Patch('material-requests/:id/decide')
  async decide(
    @Param('id') id: string,
    @Body() dto: DecideMaterialRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.requests.decide(id, dto, user.sub);
    this.realtime.emitToAdmin('material_request.decided', { requestId: id, status: result.status });
    if (result.technicianId) {
      const label =
        dto.decision === 'reject'
          ? 'ditolak'
          : dto.decision === 'revise'
            ? 'direvisi & disetujui'
            : 'disetujui';
      this.notifications
        .notify(result.technicianId, {
          title: 'Pengajuan Material Diputuskan',
          body: `Pengajuan material kamu ${label} admin.`,
          type: 'request_decided',
          target: id,
        })
        .catch(() => {
          // notify() sendiri udah nangkep error push internal — catch di
          // sini cuma jaga-jaga kalau baris `notifications`-nya sendiri
          // gagal ditulis, biar gak nge-throw balik ke response decide()
          // yang aksi utamanya (approve/reject) udah sukses & ke-commit.
        });
    }
    return result;
  }

  @Roles('admin', 'teknisi')
  @Patch('material-requests/:id/mark-used')
  markUsed(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.requests.markUsed(id, user.sub, user.role);
  }
}
