import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { InvoicesService } from './invoices.service';
import { resolveUploadFile } from '../common/uploads/uploads.controller';

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

  // Foto pengerjaan untuk halaman struk: hanya foto milik nota dengan token ini (bukan akses bebas ke /uploads).
  @Get(':token/photo/:photoId')
  async photo(@Param('token') token: string, @Param('photoId') photoId: string, @Res() res: Response) {
    const abs = resolveUploadFile(await this.invoices.findPublicReceiptPhotoPath(token, photoId));
    if (!existsSync(abs)) throw new NotFoundException('Foto tidak ditemukan');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(abs, { dotfiles: 'deny' });
  }
}
