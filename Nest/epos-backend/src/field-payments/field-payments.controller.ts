import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { photoUploadOptions } from '../common/uploads/photo-upload';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { FieldPaymentsService } from './field-payments.service';
import { CreateFieldPaymentDto } from './dto/create-field-payment.dto';
import { SendReceiptDto } from './dto/send-receipt.dto';
import { METHOD_LABEL, type FieldPaymentMethod } from './field-payment.constants';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class FieldPaymentsController {
  constructor(
    private readonly payments: FieldPaymentsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  // Teknisi mencatat pembayaran di lokasi (multipart: method, amount, note?, clientRef?, file `proof`).
  @Roles('teknisi')
  @Post('technician-jobs/:jobId/field-payments')
  @UseInterceptors(FileInterceptor('proof', photoUploadOptions('payment-proofs', 10)))
  async record(
    @Param('jobId') jobId: string,
    @Body() dto: CreateFieldPaymentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    // multer diam-diam melewati request yang bukan multipart; foto bukti wajib untuk semua metode.
    if (!file) {
      throw new BadRequestException('Foto bukti pembayaran wajib. Ambil/pilih fotonya (JPG/PNG/WEBP, maks 10MB) lalu coba lagi.');
    }
    const r = await this.payments.record(jobId, dto, `/uploads/payment-proofs/${file.filename}`, user.sub);
    if (!r.duplicate) {
      this.realtime.emitToAdmin('field_payment.created', { paymentId: r.payment.id, jobId });
      void this.notifyAdmins(jobId, r.payment).catch(() => undefined);
    }
    return r;
  }

  private async notifyAdmins(
    jobId: string,
    p: { id: string; receiptNumber: string; method: string; amount: unknown },
  ) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      select: { member: { select: { name: true } }, technician: { select: { displayName: true } } },
    });
    const rp = `Rp ${Number(p.amount).toLocaleString('id-ID')}`;
    const metode = METHOD_LABEL[p.method as FieldPaymentMethod] ?? p.method;
    const cocok = p.method === 'tunai' ? 'Uang dibawa teknisi, cocokkan saat setoran.' : 'Cocokkan dengan mutasi/notifikasi rekening toko.';
    await this.notifications.notifyRoles(['admin'], {
      title: 'Pembayaran Lapangan Dicatat',
      body: `${job?.technician?.displayName ?? 'Teknisi'} mencatat ${rp} (${metode})${job?.member ? ` dari ${job.member.name}` : ''}, ${p.receiptNumber}. ${cocok}`,
      type: 'field_payment',
      target: p.id,
    });
  }

  @Roles('admin', 'kasir', 'teknisi')
  @Get('technician-jobs/:jobId/field-payments')
  listForJob(@Param('jobId') jobId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.payments.listForJob(jobId, user.sub, user.role);
  }

  @Roles('teknisi', 'admin')
  @Post('field-payments/:id/send-receipt')
  sendReceipt(@Param('id') id: string, @Body() dto: SendReceiptDto, @CurrentUser() user: CurrentUserPayload) {
    return this.payments.sendReceipt(id, dto, user.sub, user.role);
  }

  // Uang yang saya pegang / riwayat catatan saya.
  @Roles('teknisi')
  @Get('field-payments/mine')
  mine(@Query('status') status: string | undefined, @CurrentUser() user: CurrentUserPayload) {
    return this.payments.mine(user.sub, status || undefined);
  }
}
