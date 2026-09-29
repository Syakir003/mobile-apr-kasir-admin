import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { InvoicesService } from './invoices.service';
import { InvoiceHistoryQueryDto } from './dto/invoice-history-query.dto';
import { CreateManualInvoiceDto } from './dto/create-manual-invoice.dto';

// Data lengkap siap dipakai render/print nota di Next.js/Flutter — generate
// PDF/gambar-nya jadi tanggung jawab frontend, backend cukup kasih data terstruktur.
// Data finansial lengkap semua customer -> admin & kasir aja (teknisi gak
// perlu, dan sebelumnya bocor kebaca karena controller ini gak punya @Roles
// sama sekali, jadi RolesGuard ngizinin semua role yang login).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'kasir')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /** Halaman "Riwayat Transaksi" — semua invoice, bisa dicari & difilter. */
  @Get()
  findAll(@Query() query: InvoiceHistoryQueryDto) {
    return this.invoices.findAll(query);
  }

  /**
   * Halaman "Input Transaksi Manual" (admin) — migrasi data histori
   * transaksi & member dari sebelum sistem ini ada. Admin-only (override
   * @Roles('admin','kasir') di level class) — beda dari checkout POS biasa,
   * ini murni entri data manual tanpa bukti fisik transaksi real-time, jadi
   * sengaja dibatasi lebih ketat daripada kasir.
   */
  @Roles('admin')
  @Post('manual')
  createManual(@Body() dto: CreateManualInvoiceDto, @CurrentUser() user: CurrentUserPayload) {
    return this.invoices.createManual(dto, user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.invoices.findOne(id, user.role);
  }

  /** Tombol "Kirim WA" manual di halaman detail invoice — Siklus WA/Fonnte. */
  @Post(':id/send-whatsapp')
  sendWhatsapp(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.invoices.sendWhatsapp(id, user.sub);
  }
}
