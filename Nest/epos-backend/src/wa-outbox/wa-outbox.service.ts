import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRpcService, RpcActor } from '../prisma/supabase-rpc.service';
import { WhatsappLogQueryDto } from './dto/wa-outbox.dto';

// `member_name` di wa_outbox kosong untuk pesan voucher/undian (RPC-nya tidak
// mengisi) — Flutter menggabungkan nama di klien; di sini lewat relasi.
const withMember = { member: { select: { id: true, name: true } } } as const;

/**
 * Antrean WhatsApp desain Supabase: baris `wa_outbox` dibuat DB (pg_cron
 * `enqueue_service_reminders`, penyelesaian job, voucher/undian), admin/kasir
 * mengirim manual lewat wa.me lalu menandainya terkirim. Nest tidak mengirim
 * WA sendiri.
 */
@Injectable()
export class WaOutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: SupabaseRpcService,
  ) {}

  /** Padanan `waOutboxStreamProvider` (reminder_providers.dart): urut created_at naik. */
  queue(status = 'pending') {
    return this.prisma.waOutbox.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      include: withMember,
    });
  }

  /** Padanan `waHistoryProvider`: selain pending, 100 terbaru. */
  history() {
    return this.prisma.waOutbox.findMany({
      where: { status: { not: 'pending' } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: withMember,
    });
  }

  /** Halaman web "Riwayat WA" — bentuk response sama modul whatsapp lama
   * (tabel whatsapp_logs-nya gak pernah ada di DB), sumbernya wa_outbox. */
  async logs(query: WhatsappLogQueryDto) {
    const { page, pageSize } = query;
    const q = query.q?.trim();
    const where: Prisma.WaOutboxWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { phone: { contains: q } },
              { memberName: { contains: q, mode: 'insensitive' } },
              { member: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.waOutbox.findMany({
        where,
        include: withMember,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.waOutbox.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      phone: r.phone,
      message: r.body,
      status: r.status,
      error: r.error,
      sentAt: r.sentAt,
      createdAt: r.createdAt,
      member: r.member,
    }));
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** "Kirim ulang" pesan gagal = balikin ke antrean pending (dikirim dari
   * antrean WA mobile), bukan kirim langsung — Fonnte sudah gak dipakai. */
  async retry(id: string) {
    const msg = await this.prisma.waOutbox.findUnique({ where: { id } });
    if (!msg) throw new NotFoundException('Pesan tidak ditemukan');
    if (msg.status !== 'gagal') throw new BadRequestException('Hanya pesan gagal yang bisa dikirim ulang');
    return this.prisma.waOutbox.update({ where: { id }, data: { status: 'pending', error: null } });
  }

  markSent(actor: RpcActor, id: string) {
    return this.rpc.call(actor, 'mark_wa_sent', { id });
  }

  cancel(actor: RpcActor, id: string, reason?: string) {
    return this.rpc.call(actor, 'cancel_wa_message', { id, reason });
  }
}
