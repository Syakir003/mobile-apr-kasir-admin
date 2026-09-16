import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

// Nama modul "services-catalog" (bukan "services") sengaja dipilih biar gak
// bentrok istilah dengan konsep umum "service" NestJS (provider/@Injectable).
@Injectable()
export class ServicesCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateServiceDto) {
    return this.prisma.service.create({ data: { ...dto, active: true } });
  }

  findAll() {
    return this.prisma.service.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  }

  /** Edit jasa setelah dibuat — sama alasannya kayak ProductsService.update. */
  async update(id: string, dto: UpdateServiceDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.service.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Jasa tidak ditemukan');

    const service = await this.prisma.service.update({ where: { id }, data: dto });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'service.update',
        target: id,
        detail: { ...dto },
      },
    });

    return service;
  }
}
