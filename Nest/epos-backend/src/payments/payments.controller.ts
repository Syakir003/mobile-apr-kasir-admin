import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'kasir')
@Controller('invoices')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Post(':id/payments')
  async record(
    @Param('id') invoiceId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.payments.record(invoiceId, dto, user.sub);
    this.realtime.emitToAdmin('invoice.updated', { invoiceId, ...result });
    return result;
  }
}
