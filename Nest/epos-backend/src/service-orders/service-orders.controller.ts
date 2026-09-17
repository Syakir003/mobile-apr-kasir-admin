import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ServiceOrdersService } from './service-orders.service';
import { ServiceIntakeDto } from './dto/service-intake.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'kasir')
@Controller('service-orders')
export class ServiceOrdersController {
  constructor(
    private readonly serviceOrders: ServiceOrdersService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Post('intake')
  async intake(@Body() dto: ServiceIntakeDto, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.serviceOrders.intake(dto, user.sub);
    this.realtime.emitToAdmin('service_order.created', result);
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
}
