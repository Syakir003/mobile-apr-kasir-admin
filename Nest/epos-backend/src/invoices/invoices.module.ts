import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { PublicReceiptController } from './public-receipt.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RemindersModule } from '../reminders/reminders.module';

@Module({
  // WhatsappModule: tombol "Kirim WA" manual di halaman detail invoice.
  // RemindersModule: RemindersService.renderTemplate() — redaksi pesan
  // invoice sekarang ikut bisa diedit admin lewat template ke-4 ('invoice').
  imports: [WhatsappModule, RemindersModule],
  controllers: [InvoicesController, PublicReceiptController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
