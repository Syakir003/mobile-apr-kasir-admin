import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { LegacyImportService } from './legacy-import.service';
import { LegacyImportDto } from './dto/legacy-import.dto';

/** Halaman "Input Data Lampau" (Administrasi) — admin only. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('legacy-import')
export class LegacyImportController {
  constructor(private readonly legacyImport: LegacyImportService) {}

  @Post()
  create(@Body() dto: LegacyImportDto, @CurrentUser() user: CurrentUserPayload) {
    return this.legacyImport.import(dto, user.sub);
  }
}
