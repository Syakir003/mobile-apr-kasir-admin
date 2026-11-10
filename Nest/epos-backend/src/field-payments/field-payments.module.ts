import { Module } from '@nestjs/common';
import { FieldPaymentsController } from './field-payments.controller';
import { FieldPaymentsService } from './field-payments.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationsModule } from '../notifications/notifications.module';

// PrismaService, CountersService, dan RealtimeGateway disediakan global (lihat modul masing-masing). Bila Nest melaporkan
// provider tidak ditemukan saat boot, impor modul pemiliknya di sini.
@Module({
  imports: [WhatsappModule, NotificationsModule],
  controllers: [FieldPaymentsController],
  providers: [FieldPaymentsService],
  exports: [FieldPaymentsService],
})
export class FieldPaymentsModule {}
