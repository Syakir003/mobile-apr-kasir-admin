import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitCorrectionDto } from './dto/submit-correction.dto';

const EDITABLE_STATUSES = ['aktif', 'dalam_maintenance'];

/**
 * Koreksi data unit AC oleh teknisi -> disetujui admin -> data unit otomatis
 * berganti. Teknisi tidak boleh mengubah data unit 'aktif' secara langsung.
 */
@Injectable()
export class AcUnitCorrectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(unitId: string, dto: SubmitCorrectionDto, userId: string) {
    const unit = await this.prisma.memberAcUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw new NotFoundException('Unit AC tidak ditemukan');
    if (!EDITABLE_STATUSES.includes(unit.status)) {
      throw new BadRequestException(
        unit.status === 'menunggu_data'
          ? 'Data unit ini belum lengkap — lengkapi datanya dulu, bukan ajukan koreksi.'
          : 'Unit ini belum bisa dikoreksi.',
      );
    }

    // Hanya field yang benar-benar berbeda dari data sekarang yang disimpan.
    const diff: Prisma.AcUnitCorrectionUncheckedCreateInput = {
      unitId,
      requestedById: userId,
      note: dto.note?.trim() || null,
    } as Prisma.AcUnitCorrectionUncheckedCreateInput;
    let changed = 0;
    const str = (v?: string) => (v?.trim() ? v.trim() : undefined);
    const brand = str(dto.brand);
    if (brand !== undefined && brand !== unit.brand) { diff.brand = brand; changed++; }
    const model = str(dto.model);
    if (model !== undefined && model !== unit.model) { diff.model = model; changed++; }
    const room = str(dto.roomLocation);
    if (room !== undefined && room !== unit.roomLocation) { diff.roomLocation = room; changed++; }
    const serial = str(dto.serialNumber);
    if (serial !== undefined && serial !== unit.serialNumber) { diff.serialNumber = serial; changed++; }
    if (dto.pk !== undefined && (unit.pk == null || Number(unit.pk) !== dto.pk)) {
      diff.pk = new Prisma.Decimal(dto.pk);
      changed++;
    }
    if (dto.installationDate) {
      const d = new Date(dto.installationDate);
      if (!unit.installationDate || unit.installationDate.getTime() !== d.getTime()) {
        diff.installationDate = d;
        changed++;
      }
    }
    if (changed === 0) {
      throw new BadRequestException('Tidak ada data yang berbeda dari data unit sekarang.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Satu koreksi pending per unit — kunci per unit biar 2 submit bareng tidak lolos dua-duanya.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'unitcorr:' + unitId}))`;
      const pending = await tx.acUnitCorrection.findFirst({ where: { unitId, status: 'pending' } });
      if (pending) {
        throw new ConflictException('Unit ini masih punya koreksi yang menunggu persetujuan admin.');
      }
      const created = await tx.acUnitCorrection.create({ data: diff });
      await tx.auditLog.create({
        data: { actorUid: userId, action: 'ac_unit.correction_submit', target: unitId, detail: { correctionId: created.id } },
      });
      return created;
    });
  }

  async list(status: string | undefined, page = 1, pageSize = 20) {
    const where: Prisma.AcUnitCorrectionWhereInput = status ? { status } : {};
    const [total, pendingCount, rows] = await Promise.all([
      this.prisma.acUnitCorrection.count({ where }),
      this.prisma.acUnitCorrection.count({ where: { status: 'pending' } }),
      this.prisma.acUnitCorrection.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          unit: {
            select: {
              id: true, barcodeValue: true, brand: true, model: true, pk: true,
              roomLocation: true, serialNumber: true, installationDate: true,
              member: { select: { id: true, name: true, phone: true, address: true } },
            },
          },
          requestedBy: { select: { id: true, displayName: true } },
          reviewedBy: { select: { id: true, displayName: true } },
        },
      }),
    ]);
    return { pendingCount, items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** Kirim koreksi yang masih pending untuk satu unit (dipakai tampilan teknisi). */
  pendingForUnit(unitId: string) {
    return this.prisma.acUnitCorrection.findFirst({ where: { unitId, status: 'pending' } });
  }

  async approve(id: string, adminId: string, reviewNote?: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.acUnitCorrection.findUnique({ where: { id } });
      if (!c) throw new NotFoundException('Koreksi tidak ditemukan');
      if (c.status !== 'pending') throw new ConflictException('Koreksi ini sudah diproses.');
      const data: Prisma.MemberAcUnitUpdateInput = {};
      if (c.brand != null) data.brand = c.brand;
      if (c.model != null) data.model = c.model;
      if (c.pk != null) data.pk = c.pk;
      if (c.roomLocation != null) data.roomLocation = c.roomLocation;
      if (c.serialNumber != null) data.serialNumber = c.serialNumber;
      if (c.installationDate != null) data.installationDate = c.installationDate;
      await tx.memberAcUnit.update({ where: { id: c.unitId }, data });
      const done = await tx.acUnitCorrection.update({
        where: { id },
        data: { status: 'approved', reviewedById: adminId, reviewedAt: new Date(), reviewNote: reviewNote?.trim() || null },
      });
      await tx.auditLog.create({
        data: { actorUid: adminId, action: 'ac_unit.correction_approve', target: c.unitId, detail: { correctionId: id, applied: Object.keys(data) } },
      });
      return done;
    });
  }

  async reject(id: string, adminId: string, reviewNote?: string) {
    if (!reviewNote?.trim()) throw new BadRequestException('Alasan penolakan wajib diisi.');
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.acUnitCorrection.findUnique({ where: { id } });
      if (!c) throw new NotFoundException('Koreksi tidak ditemukan');
      if (c.status !== 'pending') throw new ConflictException('Koreksi ini sudah diproses.');
      const done = await tx.acUnitCorrection.update({
        where: { id },
        data: { status: 'rejected', reviewedById: adminId, reviewedAt: new Date(), reviewNote: reviewNote.trim() },
      });
      await tx.auditLog.create({
        data: { actorUid: adminId, action: 'ac_unit.correction_reject', target: c.unitId, detail: { correctionId: id } },
      });
      return done;
    });
  }
}
