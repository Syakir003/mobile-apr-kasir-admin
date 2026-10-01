import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UNIT_PRODUCTS_SELECT } from './ac-unit-products.include';
import { UnitLabelsQueryDto } from './dto/unit-labels-query.dto';

const LABEL_STATUSES = ['aktif', 'menunggu_data', 'dalam_maintenance'];
const MAX_LABELS = 100;

/**
 * Tracking label QR unit AC (Input Data Lampau): daftar unit yang QR-nya
 * belum dicetak / belum ditempel, data cetak label, penanda dicetak/ditempel.
 */
@Injectable()
export class AcUnitLabelsService {
  constructor(private readonly prisma: PrismaService) {}

  private searchWhere(q?: string): Prisma.MemberAcUnitWhereInput {
    const term = q?.trim();
    if (!term) return {};
    return {
      OR: [
        { member: { name: { contains: term, mode: 'insensitive' } } },
        { member: { phone: { contains: term } } },
        { member: { address: { contains: term, mode: 'insensitive' } } },
        { roomLocation: { contains: term, mode: 'insensitive' } },
        { barcodeValue: { contains: term, mode: 'insensitive' } },
        { brand: { contains: term, mode: 'insensitive' } },
      ],
    };
  }

  async list(query: UnitLabelsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const label = query.label ?? 'belum_ditempel';
    const data = query.data ?? 'semua';

    const labelWhere: Prisma.MemberAcUnitWhereInput =
      label === 'belum_dicetak'
        ? { labelPrintedAt: null, labelAttachedAt: null }
        : label === 'belum_ditempel'
          ? { labelAttachedAt: null }
          : label === 'sudah_ditempel'
            ? { labelAttachedAt: { not: null } }
            : {};
    const dataWhere: Prisma.MemberAcUnitWhereInput =
      data === 'semua' ? {} : { status: data };

    const base: Prisma.MemberAcUnitWhereInput = {
      status: { in: LABEL_STATUSES },
      member: { active: true },
      ...this.searchWhere(query.q),
    };
    const where: Prisma.MemberAcUnitWhereInput = { AND: [base, labelWhere, dataWhere] };

    const [total, rows, belumDicetak, belumDitempel, menungguData] = await Promise.all([
      this.prisma.memberAcUnit.count({ where }),
      this.prisma.memberAcUnit.findMany({
        where,
        include: { member: { select: { id: true, name: true, phone: true, address: true } }, ...UNIT_PRODUCTS_SELECT },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.memberAcUnit.count({ where: { AND: [{ status: { in: LABEL_STATUSES } }, { labelPrintedAt: null, labelAttachedAt: null }] } }),
      this.prisma.memberAcUnit.count({ where: { AND: [{ status: { in: LABEL_STATUSES } }, { labelAttachedAt: null }] } }),
      this.prisma.memberAcUnit.count({ where: { status: 'menunggu_data' } }),
    ]);

    return {
      counts: { belumDicetak, belumDitempel, menungguData },
      items: rows.map((u) => this.toLabel(u)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** Data cetak label untuk sekumpulan unit (tanpa mengubah apa pun). */
  async labelData(ids: string[]) {
    const clean = [...new Set(ids.map((i) => i.trim()).filter(Boolean))];
    if (clean.length === 0) throw new BadRequestException('Pilih minimal satu unit.');
    if (clean.length > MAX_LABELS) {
      throw new BadRequestException(`Maksimal ${MAX_LABELS} label sekali cetak.`);
    }
    const rows = await this.prisma.memberAcUnit.findMany({
      where: { id: { in: clean } },
      include: { member: { select: { id: true, name: true, phone: true, address: true } }, ...UNIT_PRODUCTS_SELECT },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return clean.filter((id) => byId.has(id)).map((id) => this.toLabel(byId.get(id)!));
  }

  /** Tandai label sudah dicetak. Tidak menimpa unit yang sudah tercetak. */
  async markPrinted(ids: string[]) {
    const res = await this.prisma.memberAcUnit.updateMany({
      where: { id: { in: ids }, labelPrintedAt: null },
      data: { labelPrintedAt: new Date() },
    });
    return { updated: res.count };
  }

  /** Tandai label sudah ditempel (manual). */
  async markAttached(ids: string[]) {
    const now = new Date();
    const res = await this.prisma.memberAcUnit.updateMany({
      where: { id: { in: ids }, labelAttachedAt: null },
      data: { labelAttachedAt: now },
    });
    await this.prisma.memberAcUnit.updateMany({
      where: { id: { in: ids }, labelPrintedAt: null },
      data: { labelPrintedAt: now },
    });
    return { updated: res.count };
  }

  private toLabel(
    u: Prisma.MemberAcUnitGetPayload<{
      include: { member: { select: { id: true; name: true; phone: true; address: true } } } & typeof UNIT_PRODUCTS_SELECT;
    }>,
  ) {
    return {
      id: u.id,
      barcodeValue: u.barcodeValue,
      status: u.status,
      brand: u.brand,
      model: u.model,
      pk: u.pk == null ? null : Number(u.pk),
      roomLocation: u.roomLocation,
      indoorProduct: u.indoorProduct,
      outdoorProduct: u.outdoorProduct,
      labelPrintedAt: u.labelPrintedAt,
      labelAttachedAt: u.labelAttachedAt,
      member: u.member,
    };
  }
}
