import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PosService } from './pos.service';
import { CheckoutDto } from './dto/checkout.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pos')
export class PosController {
  constructor(
    private readonly posService: PosService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Roles('admin', 'kasir')
  @Post('checkout')
  async checkout(@Body() dto: CheckoutDto, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.posService.checkout(dto, user);
    this.realtime.emitToAdmin('transaction.created', result);
    return result;
  }
}
