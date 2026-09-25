import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRpcService, RpcActor } from '../prisma/supabase-rpc.service';

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

  markSent(actor: RpcActor, id: string) {
    return this.rpc.call(actor, 'mark_wa_sent', { id });
  }

  cancel(actor: RpcActor, id: string, reason?: string) {
    return this.rpc.call(actor, 'cancel_wa_message', { id, reason });
  }
}
