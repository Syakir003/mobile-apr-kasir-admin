import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppConfigService } from './app-config.service';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('app-config')
export class AppConfigController {
  constructor(private readonly service: AppConfigService) {}

  // Dibuka buat SEMUA role login (bukan cuma admin) — kasir butuh baca
  // default_tax_percent buat prefill form checkout, siapapun yang nyetak
  // nota butuh invoice_footer_note/printer_name.
  @Get()
  getAll() {
    return this.service.getAll();
  }

  @Roles('admin')
  @Put(':key')
  update(@Param('key') key: string, @Body() dto: UpdateAppConfigDto) {
    return this.service.upsert(key, dto.value);
  }
}
