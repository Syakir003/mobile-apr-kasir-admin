import { Module } from '@nestjs/common';
import { UndianController } from './undian.controller';
import { UndianService } from './undian.service';

@Module({
  controllers: [UndianController],
  providers: [UndianService],
})
export class UndianModule {}
