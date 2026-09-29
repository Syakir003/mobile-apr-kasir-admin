import { Module } from '@nestjs/common';
import { FonnteService } from './fonnte.service';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';

@Module({
  controllers: [WhatsappController],
  providers: [FonnteService, WhatsappService],
  // Dipakai InvoicesModule (tombol "Kirim WA" manual) & RemindersModule
  // (kirim reminder otomatis) — juga dipakai TechnicianJobsModule buat
  // kirim pesan "selesai servis" setelah approveComplete().
  exports: [FonnteService, WhatsappService],
})
export class WhatsappModule {}
