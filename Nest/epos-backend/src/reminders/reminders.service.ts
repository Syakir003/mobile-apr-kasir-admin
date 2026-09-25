import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRpcService, RpcActor } from '../prisma/supabase-rpc.service';
import { SaveReminderSettingsDto } from './dto/save-reminder-settings.dto';
import { SaveWaTemplatesDto } from './dto/save-wa-templates.dto';
import { SetUnitIntervalDto } from './dto/set-unit-interval.dto';

/**
 * Pengaturan Pengingat WA — padanan reminder_providers.dart.
 *
 * Tidak ada scheduler di Nest: pengantrean harian dijalankan pg_cron Supabase
 * (`pengingat-servis-harian` -> enqueue_service_reminders(), 09:00 WIB) dan
 * pesan "selesai servis" diantre RPC penyelesaian job. Antrean dikelola di
 * modul wa-outbox.
 */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: SupabaseRpcService,
  ) {}

  getSettings() {
    return this.prisma.reminderSetting.findMany({ orderBy: { jobType: 'asc' } });
  }

  async saveSettings(actor: RpcActor, dto: SaveReminderSettingsDto) {
    const save = ({ jobType, intervalDays, active }: SaveReminderSettingsDto) =>
      this.rpc.call(actor, 'save_reminder_settings', { jobType, intervalDays, active });
    if (!dto.settings) return save(dto);
    // Berurutan (bukan Promise.all) — tiap RPC transaksi sendiri, gagal di
    // tengah berhenti di situ, sama seperti Flutter memanggil per baris.
    const results: unknown[] = [];
    for (const s of dto.settings) results.push(await save(s));
    return results;
  }

  listTemplates(actor: RpcActor) {
    return this.rpc.callNoArgs(actor, 'list_wa_reminder_templates');
  }

  saveTemplates(actor: RpcActor, dto: SaveWaTemplatesDto) {
    return this.rpc.call(actor, 'save_wa_reminder_templates', { templates: dto.templates });
  }

  /** Padanan `setUnitServiceIntervalCallerProvider` (mobile, form Unit AC). */
  setUnitInterval(actor: RpcActor, dto: SetUnitIntervalDto) {
    return this.rpc.call(actor, 'set_unit_service_interval', dto);
  }
}
