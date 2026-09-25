import { Module } from '@nestjs/common';
import { ItemCostsService } from './item-costs.service';
import { ItemCostsController } from './item-costs.controller';

@Module({
  controllers: [ItemCostsController],
  providers: [ItemCostsService],
  exports: [ItemCostsService],
})
export class ItemCostsModule {}
