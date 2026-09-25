import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RemindersService } from './reminders.service';
import { SaveReminderSettingsDto } from './dto/save-reminder-settings.dto';
import { SaveWaTemplatesDto } from './dto/save-wa-templates.dto';
import { SetUnitIntervalDto } from './dto/set-unit-interval.dto';

// Baca: admin/kasir (RLS reminder_settings & cek list_wa_reminder_templates).
// Tulis: admin (cek di RPC save_*). POST /reminders/run-now DIHAPUS:
// enqueue_service_reminders() khusus pg_cron (tanpa cek role di dalamnya).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Roles('admin', 'kasir')
  @Get('settings')
  getSettings() {
    return this.reminders.getSettings();
  }

  @Roles('admin')
  @Put('settings')
  saveSettings(@Body() dto: SaveReminderSettingsDto, @CurrentUser() user: CurrentUserPayload) {
    return this.reminders.saveSettings(user, dto);
  }

  @Roles('admin', 'kasir')
  @Get('templates')
  listTemplates(@CurrentUser() user: CurrentUserPayload) {
    return this.reminders.listTemplates(user);
  }

  @Roles('admin')
  @Put('templates')
  saveTemplates(@Body() dto: SaveWaTemplatesDto, @CurrentUser() user: CurrentUserPayload) {
    return this.reminders.saveTemplates(user, dto);
  }

  // Padanan RPC `set_unit_service_interval` — override siklus servis satu
  // unit AC (form mobile "Tambah/Edit Unit AC").
  @Roles('admin')
  @Put('unit-interval')
  setUnitInterval(@Body() dto: SetUnitIntervalDto, @CurrentUser() user: CurrentUserPayload) {
    return this.reminders.setUnitInterval(user, dto);
  }
}
