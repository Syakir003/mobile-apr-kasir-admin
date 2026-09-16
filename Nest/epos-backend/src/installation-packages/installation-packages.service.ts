import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateInstallationPackageDto,
  InstallationPackageItemDto,
} from './dto/create-installation-package.dto';
import { UpdateInstallationPackageDto } from './dto/update-installation-package.dto';

/**
 * Port dari RPC save_installation_package (pos_functions.sql). Kontrak
 * asli: satu fungsi upsert-by-optional-id yang, tiap dipanggil, SELALU
 * full-replace semua item (delete semua item lama pas update, lalu insert
 * ulang semua item baru) dalam satu transaksi. Di sini dipecah jadi 2
 * endpoint REST (POST create / PATCH update) yang lebih konvensional, tapi
 * logic replace-nya tetap sama persis dengan aslinya.
 */
@Injectable()
export class InstallationPackagesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.installationPackage.findMany({
      where: { active: true },
      include: { items: { include: { sparepart: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const pkg = await this.prisma.installationPackage.findUnique({
      where: { id },
      include: { items: { include: { sparepart: true } } },
    });
    if (!pkg) throw new NotFoundException('Paket instalasi tidak ditemukan');
    return pkg;
  }

  /**
   * RPC lama gak validasi sparepart_id sama sekali (langsung cast ke uuid,
   * gantung ke FK constraint pas insert). Di sini dicek eksplisit DULU DI
   * LUAR transaction (pola sama kayak MaterialRequestsService.priceItems)
   * biar errornya jadi 400 yang jelas ("sparepart mana yang gak ketemu"),
   * bukan 500 dari FK-violation Postgres yang mentah.
   */
  private async assertSparepartsExist(items: InstallationPackageItemDto[]) {
    const ids = [
      ...new Set(items.map((i) => i.sparepartId).filter((id): id is string => !!id)),
    ];
    if (ids.length === 0) return;
    const found = await this.prisma.sparepart.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((f) => f.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Sparepart tidak ditemukan: ${missing.join(', ')}`,
      );
    }
  }

  async create(dto: CreateInstallationPackageDto, actorId: string) {
    if (!dto.name.trim()) {
      throw new BadRequestException('Nama paket wajib diisi');
    }
    await this.assertSparepartsExist(dto.items);

    const pkg = await this.prisma.installationPackage.create({
      data: {
        name: dto.name,
        description: dto.description,
        active: dto.active ?? true,
        items: {
          create: dto.items.map((item) => ({
            sparepartId: item.sparepartId ?? null,
            name: item.name,
            qty: item.qty,
            unit: item.unit,
            extraPricePerUnit: item.extraPricePerUnit ?? 0,
          })),
        },
      },
      include: { items: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'installation_package.create',
        target: pkg.id,
        detail: { name: pkg.name, itemCount: pkg.items.length },
      },
    });

    return pkg;
  }

  async update(id: string, dto: UpdateInstallationPackageDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('Nama paket wajib diisi');
    }
    if (dto.items !== undefined) {
      await this.assertSparepartsExist(dto.items);
    }

    // Lock row paket duluan (pola sama kayak decide()/markUsed() di
    // MaterialRequestsService) — cegah dua PATCH bersamaan buat paket yang
    // sama saling nubruk pas delete-then-reinsert item.
    const pkg = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM installation_packages WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.installationPackage.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Paket instalasi tidak ditemukan');

      await tx.installationPackage.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });

      if (dto.items !== undefined) {
        await tx.installationPackageItem.deleteMany({ where: { packageId: id } });
        if (dto.items.length > 0) {
          await tx.installationPackageItem.createMany({
            data: dto.items.map((item) => ({
              packageId: id,
              sparepartId: item.sparepartId ?? null,
              name: item.name,
              qty: item.qty,
              unit: item.unit,
              extraPricePerUnit: item.extraPricePerUnit ?? 0,
            })),
          });
        }
      }

      return tx.installationPackage.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });
    });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'installation_package.update',
        target: id,
        detail: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.items !== undefined ? { itemCount: dto.items.length } : {}),
        },
      },
    });

    return pkg;
  }
}
