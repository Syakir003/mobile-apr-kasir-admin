import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ServiceOrdersService } from './service-orders.service';
import { ServiceIntakeDto } from './dto/service-intake.dto';
import { CreateServiceOrderDto } from './dto/create-service-order.dto';
import { UpdateServiceOrderDto } from './dto/update-service-order.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizeTechnicianIds } from '../technician-jobs/job-assignees';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'kasir')
@Controller('service-orders')
export class ServiceOrdersController {
  constructor(
    private readonly serviceOrders: ServiceOrdersService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /** Order servis manual multi-unit (app mobile) — pengganti RPC create_service_order. */
  @Post()
  async create(@Body() dto: CreateServiceOrderDto, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.serviceOrders.createManual(dto, user.sub);
    this.realtime.emitToAdmin('service_order.created', result);
    await this.notifications.notifyJobsAssigned(result.assignedJobs);
    return result;
  }

  @Post('intake')
  async intake(@Body() dto: ServiceIntakeDto, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.serviceOrders.intake(dto, user.sub);
    this.realtime.emitToAdmin('service_order.created', result);
    // Satu notifikasi per order (bukan per unit), supaya servis banyak AC tidak membanjiri teknisi.
    await this.notifications.notifyJobsAssigned([
      { jobId: result.jobId, technicianIds: normalizeTechnicianIds(dto), unitCount: result.jobs.length },
    ]);
    return result;
  }

  @Get()
  findByCustomer(@Query('phone') phone?: string, @Query('memberId') memberId?: string) {
    return this.serviceOrders.findByCustomer({ phone, memberId });
  }

  // Buat cetak surat jalan (data terstruktur — PDF-nya tanggung jawab
  // frontend, pola sama kayak InvoicesController) dari `serviceOrderId`
  // yang dibalikin pos.checkout()/intake().
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serviceOrders.findOne(id);
  }

  // Koreksi data order (jadwal, jenis pekerjaan, note, titik lokasi kerja per unit) — ADMIN saja, walau controller ini
  // terbuka untuk kasir. Kasir yang salah input meminta admin mengoreksinya.
  @Roles('admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceOrderDto, @CurrentUser() user: CurrentUserPayload) {
    return this.serviceOrders.update(id, dto, user.sub);
  }
}
