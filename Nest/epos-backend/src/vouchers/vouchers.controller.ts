import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { CancelVoucherDto } from './dto/cancel-voucher.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Roles('admin')
  @Post()
  create(@Body() dto: CreateVoucherDto, @CurrentUser() user: CurrentUserPayload) {
    return this.vouchers.createVoucher(dto, user.sub);
  }

  // Semua voucher, terbaru dulu — admin & kasir (kasir cuma lihat, gak bisa
  // batalkan; pemakaian sesungguhnya lewat field kode voucher di POS, bukan
  // aksi di halaman ini).
  @Roles('admin', 'kasir')
  @Get()
  findAll() {
    return this.vouchers.findAll();
  }

  @Roles('admin')
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelVoucherDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.vouchers.cancelVoucher(id, dto.reason, user.sub);
  }
}
