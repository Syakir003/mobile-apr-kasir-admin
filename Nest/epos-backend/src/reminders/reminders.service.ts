import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, TechnicianJobStatus, WhatsappMessageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { waPhone, formatTanggalId } from '../whatsapp/wa-format.util';
import { wibDayRange, wibDateKey, wibDateOnly } from '../common/wib-date.util';
import { SaveReminderSettingsDto } from './dto/save-reminder-settings.dto';
import { SaveWaTemplatesDto } from './dto/save-wa-templates.dto';

/** Jenis job yang MEMANG bisa dijadwalkan ulang — port dari constraint
 * `job_type in ('cuci','maintenance')` di RPC save_reminder_settings SQL.
 * 'pemasangan'/'bongkar'/'bongkar_pasang'/'service' sekali kerja, gak ada
 * siklus berikutnya yang bisa diprediksi. */
export const SCHEDULABLE_JOB_TYPES = ['cuci', 'maintenance'] as const;

// 'invoice' ditambah belakangan (awalnya redaksi invoice hardcoded di
// InvoicesService) — user minta itu ikut bisa diedit admin juga, sama kayak
// 3 template reminder. Taruh paling depan karena paling sering kepake
// (tiap kasir klik "Kirim WA" di invoice), bukan cuma jalan cron harian.
const TEMPLATE_KINDS = ['invoice', 'selesai_servis', 'reminder_h3', 'reminder_h7'] as const;
type TemplateKind = (typeof TEMPLATE_KINDS)[number];

// Placeholder yang SAH beda per kind — invoice gak ada konsep {unit} (bisa
// macem-macem: produk/jasa/sparepart campur), reminder gak ada {nomor}/
// {item}/{total}/{status} (belum tentu ada invoice yang relevan). Validasi
// saveTemplates() nolak placeholder yang gak ada di daftar kind-nya sendiri.
const PLACEHOLDERS_BY_KIND: Record<TemplateKind, string[]> = {
  invoice: ['nama', 'nomor', 'tanggal', 'item', 'total', 'status'],
  selesai_servis: ['nama', 'unit', 'tanggal'],
  reminder_h3: ['nama', 'unit', 'tanggal'],
  reminder_h7: ['nama', 'unit', 'tanggal'],
};

/** Redaksi bawaan. 3 kind reminder teksnya PERSIS sama dengan
 * default_wa_template() di migrasi Supabase 20260902000032_wa_reminder_templates.sql
 * biar pelanggan gak ngerasa ganti "suara" toko cuma gara-gara pindah
 * backend; `invoice` port dari teks yang tadinya hardcoded di
 * InvoicesService.sendWhatsapp. */
const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  invoice:
    'Halo {nama}, berikut invoice pembelian Anda:\n\n' +
    'No. Invoice: {nomor}\n' +
    'Tanggal: {tanggal}\n\n' +
    '{item}\n\n' +
    'Total: {total}\n' +
    'Status: {status}\n\n' +
    'Terima kasih sudah mempercayakan AC Anda kepada kami.\n\n— Ayub Podo Rukun',
  selesai_servis:
    'Halo {nama}, pekerjaan AC Anda sudah selesai:\n{unit}\n\n' +
    'Terima kasih sudah mempercayakan perawatan AC Anda kepada kami. ' +
    'Kami ingatkan lagi otomatis menjelang {tanggal}.\n\n— Ayub Podo Rukun',
  reminder_h3:
    'Halo {nama}, AC berikut dijadwalkan servis pada {tanggal}:\n{unit}\n\n' +
    'Mau kami jadwalkan teknisi? Balas pesan ini ya.\n\n— Ayub Podo Rukun',
  reminder_h7:
    'Halo {nama}, jadwal servis AC berikut sudah lewat sejak {tanggal}:\n{unit}\n\n' +
    'Perawatan rutin menjaga AC tetap dingin dan hemat listrik. ' +
    'Balas pesan ini kalau mau kami kirim teknisi.\n\n— Ayub Podo Rukun',
};

// Lapis fallback terakhir — cuma nyala kalau `kind` di luar nilai yang
// dikenal, yang gak pernah kejadian lewat pemanggil sekarang. Dijaga tetap
// ada supaya buildBody()/renderTemplate() TIDAK PERNAH melempar/
// mengembalikan string kosong — pengingat/invoice gagal gak boleh pernah
// menjatuhkan alur bisnis inti (job selesai / checkout).
const GENERIC_FALLBACK_TEMPLATE =
  'Halo {nama}, ada info dari kami untuk Anda.\n\n— Ayub Podo Rukun';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  // ======================================================== Pengaturan siklus

  async getSettings() {
    const rows = await this.prisma.reminderSetting.findMany({
      orderBy: { jobType: 'asc' },
    });
    const byType = new Map(rows.map((r) => [r.jobType, r]));
    // Selalu balikin kedua jenis job (cuci & maintenance) walau baris DB-nya
    // belum ada (mis. abis migrasi manual yg gagal seed) — form frontend
    // jadi gak pernah nemu undefined.
    return SCHEDULABLE_JOB_TYPES.map((jobType) => {
      const row = byType.get(jobType);
      return {
        jobType,
        intervalDays: row?.intervalDays ?? 60,
        active: row?.active ?? true,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async saveSettings(dto: SaveReminderSettingsDto, actorId: string) {
    for (const entry of dto.settings) {
      if (!(SCHEDULABLE_JOB_TYPES as readonly string[]).includes(entry.jobType)) {
        throw new BadRequestException(
          `Jenis pekerjaan tidak bisa dijadwalkan ulang: ${entry.jobType}`,
        );
      }
    }

    await this.prisma.$transaction(
      dto.settings.map((entry) =>
        this.prisma.reminderSetting.upsert({
          where: { jobType: entry.jobType },
          update: { intervalDays: entry.intervalDays, active: entry.active, updatedById: actorId },
          create: {
            jobType: entry.jobType,
            intervalDays: entry.intervalDays,
            active: entry.active,
            updatedById: actorId,
          },
        }),
      ),
    );

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'reminder.settings',
        // Prisma's Json input type gak nerima array instance class DTO
        // langsung (class-validator/class-transformer nempelin metadata di
        // prototype-nya) — di-map ke object polos dulu biar structural-nya
        // cocok sama InputJsonValue.
        detail: {
          settings: dto.settings.map((s) => ({
            jobType: s.jobType,
            intervalDays: s.intervalDays,
            active: s.active,
          })),
        },
      },
    });

    return this.getSettings();
  }

  // ============================================================== Template

  /** Padanan list_wa_reminder_templates() RPC — satu panggilan balikin teks
   * sekarang + teks bawaan tiap pesan, biar tombol "Reset ke bawaan" di
   * frontend gak perlu nyalin redaksi manual. */
  async listTemplates() {
    const rows = await this.prisma.waReminderTemplate.findMany();
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    return TEMPLATE_KINDS.map((kind) => {
      const row = byKind.get(kind);
      return {
        kind,
        body: row?.body?.trim() || DEFAULT_TEMPLATES[kind],
        defaultBody: DEFAULT_TEMPLATES[kind],
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async saveTemplates(dto: SaveWaTemplatesDto, actorId: string) {
    const entries = Object.entries(dto.templates) as [string, string][];
    if (entries.length === 0) {
      throw new BadRequestException('Tidak ada teks pesan untuk disimpan');
    }

    for (const [kind, body] of entries) {
      if (!(TEMPLATE_KINDS as readonly string[]).includes(kind)) {
        throw new BadRequestException(`Jenis pesan tidak dikenal: ${kind}`);
      }
      const trimmed = body?.trim() ?? '';
      if (trimmed === '') {
        throw new BadRequestException(`Teks pesan tidak boleh kosong (${kind})`);
      }
      if (trimmed.length > 1000) {
        throw new BadRequestException(`Teks pesan maksimal 1000 karakter (${kind})`);
      }
      // Tolak placeholder salah ketik ({name}, {tgl}, {ac}, ...) ATAU
      // placeholder yang sah tapi bukan buat kind ini (mis. {unit} di
      // template invoice) — kalau lolos, teks itu terkirim mentah ke
      // pelanggan. Port dari regex yang sama persis di RPC
      // save_wa_reminder_templates SQL, diperluas per-kind karena sekarang
      // ada 2 set placeholder beda (invoice vs reminder).
      const allowed = PLACEHOLDERS_BY_KIND[kind as TemplateKind];
      const placeholderRe = new RegExp(`\\{(${allowed.join('|')})\\}`, 'g');
      if (trimmed.replace(placeholderRe, '').match(/\{[^{}]*\}/)) {
        throw new BadRequestException(
          `Kata kunci tak dikenal di pesan ${kind}. Hanya ${allowed.map((p) => `{${p}}`).join(', ')} yang bisa dipakai.`,
        );
      }
    }

    await this.prisma.$transaction(
      entries.map(([kind, body]) =>
        this.prisma.waReminderTemplate.upsert({
          where: { kind },
          update: { body: body.trim(), updatedById: actorId },
          create: { kind, body: body.trim(), updatedById: actorId },
        }),
      ),
    );

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'reminder.templates',
        detail: { kinds: entries.map(([k]) => k) },
      },
    });

    return this.listTemplates();
  }

  // ===================================================== Resolusi & redaksi

  /**
   * Siklus efektif satu unit utk satu jenis job, dalam hari. 0 = jangan
   * dijadwalkan (jenis job sekali-kerja, atau default job type itu
   * dinonaktifkan admin). Urutan (yg pertama ketemu menang) — port dari
   * resolve_service_interval_days() SQL migrasi 0023:
   *   1. MemberAcUnit.serviceIntervalDays (override per unit)
   *   2. ReminderSetting.intervalDays (default per jenis job, kalau active)
   *   3. 0
   */
  async resolveIntervalDaysTx(
    tx: Prisma.TransactionClient,
    unitId: string,
    jobType: string,
  ): Promise<number> {
    const unit = await tx.memberAcUnit.findUnique({
      where: { id: unitId },
      select: { serviceIntervalDays: true },
    });
    if (unit?.serviceIntervalDays != null) return unit.serviceIntervalDays;

    const setting = await tx.reminderSetting.findUnique({ where: { jobType } });
    if (setting?.active) return setting.intervalDays;

    return 0;
  }

  /** Port dari build_wa_body() SQL — fallback berlapis (baris tabel ->
   * default kode -> generik) supaya TIDAK PERNAH melempar/kosong. */
  private async buildBodyTx(
    tx: Prisma.TransactionClient,
    memberId: string,
    kind: TemplateKind,
    unitIds: string[],
    dueDate: Date | null,
  ): Promise<string> {
    const member = await tx.member.findUnique({ where: { id: memberId } });
    const nama = member?.name?.trim() || 'Pelanggan';

    const units = await tx.memberAcUnit.findMany({
      where: { id: { in: unitIds } },
      orderBy: { roomLocation: 'asc' },
    });
    const unitText =
      units.length > 0
        ? units
            .map((u) => `- ${u.brand ?? ''} ${u.model ?? ''} (${u.roomLocation ?? '-'})`.replace(/\s+/g, ' ').trim())
            .join('\n')
        : '- Unit AC Anda';

    const templateRow = await tx.waReminderTemplate.findUnique({ where: { kind } });
    const template =
      (templateRow?.body?.trim() || undefined) ?? DEFAULT_TEMPLATES[kind] ?? GENERIC_FALLBACK_TEMPLATE;

    return template
      .replaceAll('{nama}', nama)
      .replaceAll('{unit}', unitText)
      .replaceAll('{tanggal}', formatTanggalId(dueDate));
  }

  /**
   * Render template non-transactional untuk pemakaian DI LUAR alur job/
   * reminder — dipakai InvoicesService.sendWhatsapp() buat pesan invoice
   * manual (tombol "Kirim WA"). Beda dari buildBodyTx(): gak butuh `tx`
   * (bukan bagian transaksi bisnis apa pun, invoice udah lama commit
   * sebelum tombol ini diklik), dan placeholder-nya sepenuhnya generik lewat
   * `values` (bukan cuma {nama}/{unit}/{tanggal} yang di-hardcode di sana).
   * Fallback berlapis yang sama: baris DB -> DEFAULT_TEMPLATES -> generik,
   * jadi render TIDAK PERNAH throw / balikin string kosong.
   */
  async renderTemplate(kind: TemplateKind, values: Record<string, string>): Promise<string> {
    const templateRow = await this.prisma.waReminderTemplate.findUnique({ where: { kind } });
    let body =
      (templateRow?.body?.trim() || undefined) ?? DEFAULT_TEMPLATES[kind] ?? GENERIC_FALLBACK_TEMPLATE;

    for (const [key, value] of Object.entries(values)) {
      body = body.replaceAll(`{${key}}`, value);
    }

    return body;
  }

  /**
   * Dipanggil TechnicianJobsService.approveComplete() DI DALAM transaksi
   * penyelesaian job — hanya bikin baris WhatsappLog 'pending' (belum
   * benar-benar kirim, lihat komentar WhatsappService), balikin `null` kalau
   * member gak eligible (nonaktif/opt-out/gak ada nomor) atau dedupeKey
   * 'job:<jobId>' udah pernah dipakai sebelumnya (retry approveComplete).
   */
  async enqueueJobCompleteMessageTx(
    tx: Prisma.TransactionClient,
    params: { jobId: string; memberId: string; unitId: string; dueDate: Date },
  ) {
    const member = await tx.member.findUnique({ where: { id: params.memberId } });
    if (!member || !member.active || member.waOptOut) return null;
    const phone = waPhone(member.phone);
    if (!phone) return null;

    const message = await this.buildBodyTx(
      tx,
      params.memberId,
      'selesai_servis',
      [params.unitId],
      params.dueDate,
    );

    return this.whatsapp.createPendingTx(tx, {
      memberId: params.memberId,
      kind: WhatsappMessageKind.selesai_servis,
      unitIds: [params.unitId],
      phone,
      message,
      dueDate: params.dueDate,
      dedupeKey: `job:${params.jobId}`,
    });
  }

  // ====================================================== Scheduler harian

  /**
   * 09:00 WIB tiap hari — port dari enqueue_service_reminders() + cron.schedule
   * ('pengingat-servis-harian', '0 2 * * *') migrasi Supabase 0025. Pakai
   * opsi `timeZone` @nestjs/schedule langsung (gak perlu hitung manual UTC
   * offset kayak komentar SQL aslinya).
   */
  @Cron('0 9 * * *', { name: 'pengingat-servis-harian', timeZone: 'Asia/Jakarta' })
  async handleDailyCron() {
    const result = await this.runDailyEnqueue();
    this.logger.log(
      `Pengingat servis harian: ${result.enqueued} pesan diantre, ${result.sent} terkirim, ${result.failed} gagal.`,
    );
  }

  /** Dipanggil cron di atas MAUPUN admin lewat POST /reminders/run-now (buat
   * testing/manual trigger tanpa nunggu jam 9 pagi). Aman dipanggil
   * berkali-kali sehari — dedupeKey unik yang menjaga, bukan jadwal yang
   * harus tepat sekali jalan (sama seperti catatan di SQL asli). */
  async runDailyEnqueue(): Promise<{ enqueued: number; sent: number; failed: number }> {
    const now = new Date();
    const plus3 = wibDayRange(new Date(now.getTime() + 3 * 86400000));
    const minus7 = wibDayRange(new Date(now.getTime() - 7 * 86400000));

    const units = await this.prisma.memberAcUnit.findMany({
      where: {
        status: 'aktif',
        nextServiceDate: { not: null },
        member: { active: true, waOptOut: false },
        // "jika belum pernah diservis lagi": begitu unit punya job yang
        // masih berjalan, pengingat berhenti sendiri — port dari `not
        // exists (... j.status not in ('selesai','dibatalkan'))` di SQL.
        technicianJobs: {
          none: {
            status: { notIn: [TechnicianJobStatus.selesai, TechnicianJobStatus.dibatalkan] },
          },
        },
        OR: [
          { nextServiceDate: { gte: plus3.start, lte: plus3.end } },
          { nextServiceDate: { gte: minus7.start, lte: minus7.end } },
        ],
      },
      include: { member: true },
    });

    // Satu member dengan beberapa AC jatuh tempo di hari & jenis pengingat
    // yang sama menerima SATU pesan berisi semua unitnya, bukan N pesan —
    // port dari CTE `grouped` di enqueue_service_reminders() SQL.
    type GroupKey = string;
    const groups = new Map<
      GroupKey,
      { memberId: string; kind: TemplateKind; dueDate: Date; unitIds: string[] }
    >();

    for (const unit of units) {
      if (!unit.nextServiceDate) continue;
      const isPlus3 =
        unit.nextServiceDate >= plus3.start && unit.nextServiceDate <= plus3.end;
      const kind: TemplateKind = isPlus3 ? 'reminder_h3' : 'reminder_h7';
      const dueDate = wibDateOnly(unit.nextServiceDate);
      const key = `${unit.memberId}:${kind}:${wibDateKey(unit.nextServiceDate)}`;

      const existing = groups.get(key);
      if (existing) {
        existing.unitIds.push(unit.id);
      } else {
        groups.set(key, { memberId: unit.memberId, kind, dueDate, unitIds: [unit.id] });
      }
    }

    let enqueued = 0;
    let sent = 0;
    let failed = 0;

    for (const group of groups.values()) {
      const member = await this.prisma.member.findUnique({ where: { id: group.memberId } });
      const phone = waPhone(member?.phone);
      if (!phone) continue;

      const dedupeKey = `${group.memberId}:${group.kind}:${wibDateKey(group.dueDate)}`;
      // Insert-if-not-exists via P2002 (pola sama kayak findOrCreateCategory
      // di TechnicianJobsService). `this.prisma` dioper langsung sebagai
      // "tx" di sini — PrismaService superset dari Prisma.TransactionClient
      // (structural typing), dan tiap grup memang cuma 1 statement insert
      // berdiri sendiri, gak butuh transaksi multi-langkah beneran.
      const db = this.prisma as unknown as Prisma.TransactionClient;
      const message = await this.buildBodyTx(db, group.memberId, group.kind, group.unitIds, group.dueDate);
      const log = await this.whatsapp.createPendingTx(db, {
        memberId: group.memberId,
        kind:
          group.kind === 'reminder_h3'
            ? WhatsappMessageKind.reminder_h3
            : WhatsappMessageKind.reminder_h7,
        unitIds: group.unitIds,
        phone,
        message,
        dueDate: group.dueDate,
        dedupeKey,
      });
      if (!log) continue; // udah pernah diantre hari ini (idempotent re-run)
      enqueued += 1;

      try {
        const final = await this.whatsapp.sendPendingLog(log.id);
        if (final.status === 'terkirim') sent += 1;
        else failed += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`Gagal kirim pengingat WA (log ${log.id}): ${e}`);
      }
    }

    return { enqueued, sent, failed };
  }
}
