import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, WhatsappLogStatus, WhatsappMessageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FonnteService } from './fonnte.service';
import { waPhone } from './wa-format.util';

/**
 * Titik tunggal yang BENERAN manggil Fonnte + nulis WhatsappLog — dipakai
 * baik oleh alur manual (InvoicesService.sendWhatsapp, tombol "Kirim WA")
 * maupun alur otomatis (RemindersService, TechnicianJobsService.approveComplete).
 *
 * Prinsip arsitektur yang dipegang di sini (sesuai arahan): panggilan HTTP ke
 * Fonnte SELALU terjadi SETELAH baris WhatsappLog 'pending' committed ke DB —
 * kode yang butuh insert row itu di dalam transaksi (mis. RemindersService
 * saat enqueue, atau approveComplete) manggil createPendingTx() DI DALAM
 * transaksinya, lalu manggil send()/sendPendingLog() SETELAH transaksi itu
 * commit. Ini menghindari nahan lock Postgres sambil nunggu network I/O ke
 * Fonnte (yang bisa lambat/timeout).
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fonnte: FonnteService,
  ) {}

  /**
   * Bikin baris WhatsappLog 'pending' DI DALAM transaksi caller (`tx`).
   * `dedupeKey` diisi utk pesan reminder (biar anti-duplikat structural,
   * lihat komentar model WhatsappLog) — kalau kunci itu udah pernah dipakai
   * (retry approveComplete/scheduler), P2002 ditangkap dan method ini
   * balikin `null` (BUKAN error) supaya pemanggil (yang transaksi bisnis
   * utamanya jauh lebih penting daripada notifikasi WA) gak ikut rollback.
   */
  async createPendingTx(
    tx: Prisma.TransactionClient,
    params: {
      memberId?: string;
      kind: WhatsappMessageKind;
      unitIds?: string[];
      invoiceId?: string;
      phone: string;
      message: string;
      dueDate?: Date | null;
      dedupeKey?: string;
    },
  ) {
    try {
      return await tx.whatsappLog.create({
        data: {
          memberId: params.memberId,
          kind: params.kind,
          unitIds: params.unitIds ?? [],
          invoiceId: params.invoiceId,
          phone: params.phone,
          message: params.message,
          dueDate: params.dueDate ?? undefined,
          dedupeKey: params.dedupeKey,
          status: WhatsappLogStatus.pending,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Kirim satu WhatsappLog yang masih 'pending' lewat Fonnte, lalu update
   * status-nya. Dipanggil SETELAH transaksi yang bikin baris itu commit.
   * Gak pernah throw ke pemanggil (kegagalan Fonnte dicatat di kolom
   * `error`, bukan exception) — kegagalan kirim WA gak boleh pernah
   * menjatuhkan alur bisnis utama (job selesai, checkout invoice, dst),
   * sama prinsipnya kayak komentar build_wa_body() di SQL asli.
   */
  async sendPendingLog(logId: string) {
    return this.dispatch(logId, [WhatsappLogStatus.pending]);
  }

  /** Admin klik "Kirim Ulang" di halaman Riwayat WA utk baris berstatus 'gagal'. */
  async retry(logId: string) {
    return this.dispatch(logId, [WhatsappLogStatus.gagal]);
  }

  private async dispatch(logId: string, allowedStatuses: WhatsappLogStatus[]) {
    const log = await this.prisma.whatsappLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException('Log WhatsApp tidak ditemukan');
    if (!allowedStatuses.includes(log.status)) {
      throw new BadRequestException(
        `Pesan berstatus '${log.status}' tidak bisa diproses di langkah ini`,
      );
    }

    const result = await this.fonnte.send(log.phone, log.message);
    return this.prisma.whatsappLog.update({
      where: { id: logId },
      data: {
        status: result.ok ? WhatsappLogStatus.terkirim : WhatsappLogStatus.gagal,
        providerResponse: (result.raw ?? undefined) as Prisma.InputJsonValue | undefined,
        error: result.ok ? null : (result.error ?? 'Gagal mengirim, alasan tidak diketahui'),
        sentAt: result.ok ? new Date() : undefined,
      },
    });
  }

  /**
   * Alur manual "Kirim WA" (InvoicesService.sendWhatsapp) — beda dari
   * reminder: bukan bagian transaksi bisnis apa pun (checkout invoice sudah
   * lama selesai sebelum tombol ini diklik), jadi insert row + kirim
   * dilakukan langsung berurutan di sini, gak perlu dipecah tx/non-tx kayak
   * createPendingTx+sendPendingLog. Boleh dipanggil berkali-kali per invoice
   * (resend) — TIDAK pakai dedupeKey sama sekali.
   */
  async sendInvoiceMessage(params: {
    invoiceId: string;
    memberId?: string | null;
    phone: string;
    message: string;
    actorId: string;
  }) {
    const phone = waPhone(params.phone);
    if (!phone) {
      throw new BadRequestException(
        'Invoice ini tidak punya nomor HP pelanggan yang valid',
      );
    }

    const log = await this.prisma.whatsappLog.create({
      data: {
        memberId: params.memberId ?? undefined,
        kind: WhatsappMessageKind.invoice,
        invoiceId: params.invoiceId,
        phone,
        message: params.message,
        status: WhatsappLogStatus.pending,
        sentById: params.actorId,
      },
    });

    return this.dispatch(log.id, [WhatsappLogStatus.pending]);
  }

  /** Halaman "Riwayat WA" — semua log, bisa difilter kind/status, terbaru dulu. */
  async history(query: {
    page?: number;
    pageSize?: number;
    kind?: WhatsappMessageKind;
    status?: WhatsappLogStatus;
    q?: string;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const q = query.q?.trim();

    const where: Prisma.WhatsappLogWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { phone: { contains: q } },
              { member: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.whatsappLog.findMany({
        where,
        include: { member: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.whatsappLog.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
}
