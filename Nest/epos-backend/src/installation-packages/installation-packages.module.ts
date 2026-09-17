import { Module } from '@nestjs/common';
import { InstallationPackagesService } from './installation-packages.service';
import { InstallationPackagesController } from './installation-packages.controller';

@Module({
  controllers: [InstallationPackagesController],
  providers: [InstallationPackagesService],
  exports: [InstallationPackagesService],
})
export class InstallationPackagesModule {}
