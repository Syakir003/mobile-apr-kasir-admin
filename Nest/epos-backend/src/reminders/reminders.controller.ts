import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RemindersService } from './reminders.service';
import { SaveReminderSettingsDto } from './dto/save-reminder-settings.dto';
import { SaveWaTemplatesDto } from './dto/save-wa-templates.dto';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { ServiceScheduleService } from './service-schedule.service';
import { SetUnitIntervalDto } from './dto/set-unit-interval.dto';

/** Halaman "Pengingat WA" (admin) — padanan reminder_settings_screen.dart +
 * reminder_template_screen.dart mobile, digabung jadi 1 halaman 2 tab di web. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly schedule: ServiceScheduleService,
  ) {}

  // Monitoring jadwal servis semua set AC (2026-09-30).
  @Roles('admin', 'kasir')
  @Get('schedule')
  getSchedule(@Query() query: ScheduleQueryDto) {
    return this.schedule.schedule(query);
  }

  // Kirim pengingat manual untuk 1 set AC (di luar cron), admin only.
  @Roles('admin')
  @Post('units/:unitId/send-now')
  sendNow(@Param('unitId') unitId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.schedule.sendNow(unitId, user.sub);
  }

  @Roles('admin', 'kasir')
  @Get('settings')
  getSettings() {
    return this.reminders.getSettings();
  }

  @Roles('admin')
  @Put('settings')
  saveSettings(@Body() dto: SaveReminderSettingsDto, @CurrentUser() user: CurrentUserPayload) {
    return this.reminders.saveSettings(dto, user.sub);
  }

  @Roles('admin', 'kasir')
  @Get('templates')
  listTemplates() {
    return this.reminders.listTemplates();
  }

  @Roles('admin')
  @Put('templates')
  saveTemplates(@Body() dto: SaveWaTemplatesDto, @CurrentUser() user: CurrentUserPayload) {
    return this.reminders.saveTemplates(dto, user.sub);
  }

  // Trigger manual — dipakai admin buat testing (gak perlu nunggu jam 9 pagi)
  // ATAU nyusul jalanin siklus kalau server sempat mati pas jadwal cron-nya.
  /** Override siklus servis 1 unit AC (app mobile, detail unit). */
  @Roles('admin')
  @Put('unit-interval')
  setUnitInterval(@Body() dto: SetUnitIntervalDto, @CurrentUser() user: CurrentUserPayload) {
    return this.reminders.setUnitInterval(dto, user.sub);
  }

  @Roles('admin')
  @Post('run-now')
  runNow() {
    return this.reminders.runDailyEnqueue();
  }
}
