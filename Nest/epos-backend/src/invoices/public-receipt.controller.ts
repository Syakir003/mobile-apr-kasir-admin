import { Controller, Get, Header, Param } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

// TANPA guard: dibuka pelanggan lewat tautan di WhatsApp. Yang melindungi hanya token acak 192-bit
// (tidak bisa ditebak); data yang dikembalikan sudah dibatasi (lihat InvoicesService.findPublicReceipt).
@Controller('public/receipt')
export class PublicReceiptController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  findOne(@Param('token') token: string) {
    return this.invoices.findPublicReceipt(token);
  }
}
