import { Module } from '@nestjs/common';
import { ServicesCatalogService } from './services-catalog.service';
import { ServicesCatalogController } from './services-catalog.controller';

@Module({
  controllers: [ServicesCatalogController],
  providers: [ServicesCatalogService],
})
export class ServicesCatalogModule {}
