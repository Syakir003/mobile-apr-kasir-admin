import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { UndianController } from './undian.controller';
import { UndianService } from './undian.service';

@Module({
  imports: [WhatsappModule],
  controllers: [UndianController],
  providers: [UndianService],
})
export class UndianModule {}
