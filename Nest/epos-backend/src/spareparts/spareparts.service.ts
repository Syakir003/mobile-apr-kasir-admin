import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSparepartDto } from './dto/create-sparepart.dto';
import { UpdateSparepartDto } from './dto/update-sparepart.dto';

@Injectable()
export class SparepartsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSparepartDto) {
    return this.prisma.sparepart.create({ data: { ...dto, active: true } });
  }

  findAll() {
    return this.prisma.sparepart.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  }

  /** Dipakai autocomplete input sparepart teknisi (requirement eksplisit). */
  search(query: string) {
    return this.prisma.sparepart.findMany({
      where: { active: true, name: { contains: query, mode: 'insensitive' } },
      take: 10,
      orderBy: { name: 'asc' },
    });
  }

  /** Edit sparepart setelah dibuat — sama alasannya kayak ProductsService.update. */
  async update(id: string, dto: UpdateSparepartDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.sparepart.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sparepart tidak ditemukan');

    const sparepart = await this.prisma.sparepart.update({ where: { id }, data: dto });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'sparepart.update',
        target: id,
        detail: { ...dto },
      },
    });

    return sparepart;
  }
}
