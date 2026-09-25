import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Sparepart } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSparepartDto } from './dto/create-sparepart.dto';
import { UpdateSparepartDto } from './dto/update-sparepart.dto';

/** stock/min_stock bertipe numeric (Decimal) — kirim sebagai number. */
const toJson = (s: Sparepart) => ({ ...s, stock: Number(s.stock), minStock: Number(s.minStock) });

/** Tulis TS (tak ada RPC): RLS "spareparts: tulis/ubah admin" -> @Roles('admin'). */
@Injectable()
export class SparepartsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSparepartDto) {
    // category NOT NULL tanpa default di Supabase.
    const row = await this.prisma.sparepart.create({ data: { ...dto, category: dto.category ?? '' } });
    return toJson(row);
  }

  async findAll() {
    const rows = await this.prisma.sparepart.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    return rows.map(toJson);
  }

  /** Dipakai autocomplete input sparepart teknisi. */
  async search(query: string) {
    const rows = await this.prisma.sparepart.findMany({
      where: { active: true, name: { contains: query, mode: 'insensitive' } },
      take: 10,
      orderBy: { name: 'asc' },
    });
    return rows.map(toJson);
  }

  async update(id: string, dto: UpdateSparepartDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.sparepart.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sparepart tidak ditemukan');

    const row = await this.prisma.sparepart.update({ where: { id }, data: dto });
    await this.prisma.auditLog.create({
      data: { actorUid: actorId, action: 'sparepart.update', target: id, detail: { ...dto } as Prisma.InputJsonValue },
    });
    return toJson(row);
  }
}
