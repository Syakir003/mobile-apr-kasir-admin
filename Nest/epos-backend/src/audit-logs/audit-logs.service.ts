import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

/**
 * BUKAN modul yang nulis log (itu tersebar di service lain — pos.service.ts,
 * stock.service.ts, users.service.ts, dst — masing-masing manggil
 * `this.prisma.auditLog.create(...)` sendiri pas aksi pentingnya kejadian).
 * Modul ini CUMA buat BACA — halaman "Log Audit" di web, padanan
 * `audit_log_screen.dart` di app mobile (yang baca langsung dari Supabase
 * lewat RLS, karena backend NestJS sebelum ini gak punya endpoint baca
 * audit_logs sama sekali).
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: AuditLogQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const q = query.q?.trim();
    const group = query.group?.trim();

    // from/to dari <input type="date"> browser (YYYY-MM-DD, tanpa jam) —
    // inclusive di kedua ujung hari itu, sama pola kayak InvoicesService.findAll.
    const from = query.from ? new Date(`${query.from}T00:00:00.000`) : undefined;
    const to = query.to ? new Date(`${query.to}T23:59:59.999`) : undefined;

    const where: Prisma.AuditLogWhereInput = {
      // `action` selalu format 'group.detail' (lihat komentar DTO) — prefix
      // match, BUKAN exact, biar group='pos' nangkep 'pos.checkout' &
      // 'pos.payment' sekaligus.
      ...(group ? { action: { startsWith: `${group}.` } } : {}),
      ...(from || to ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(q
        ? {
            OR: [
              { action: { contains: q, mode: 'insensitive' } },
              { target: { contains: q, mode: 'insensitive' } },
              { actor: { displayName: { contains: q, mode: 'insensitive' } } },
              { actor: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { displayName: true, email: true } } },
        orderBy: { at: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
}
