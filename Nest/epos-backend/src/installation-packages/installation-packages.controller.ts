import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { InstallationPackagesService } from './installation-packages.service';
import { CreateInstallationPackageDto } from './dto/create-installation-package.dto';
import { UpdateInstallationPackageDto } from './dto/update-installation-package.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('installation-packages')
export class InstallationPackagesController {
  constructor(
    private readonly installationPackages: InstallationPackagesService,
  ) {}

  // GET dibiarkan kebuka buat semua role yang login (gak di-@Roles) —
  // kasir butuh baca daftar paket ini pas milih paket instalasi di POS,
  // cuma create/update yang admin-only.
  @Get()
  findAll() {
    return this.installationPackages.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.installationPackages.findOne(id);
  }

  @Roles('admin')
  @Post()
  create(
    @Body() dto: CreateInstallationPackageDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.installationPackages.create(dto, user.sub);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInstallationPackageDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.installationPackages.update(id, dto, user.sub);
  }
}
