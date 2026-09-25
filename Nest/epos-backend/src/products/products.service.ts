import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

/** products.pk bertipe numeric (Decimal) — kirim sebagai number. */
const toJson = (p: Product) => ({ ...p, pk: Number(p.pk) });

/**
 * Tulis TS (tak ada RPC di Supabase): Flutter menulis `products` langsung
 * lewat RLS "products: tulis/ubah admin" — di sini dijaga @Roles('admin').
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
  ) {}

  /** `sku` "PRD-0001" dari counter global, atomik dengan insert. */
  create(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      const seq = await this.counters.nextSeq(tx, 'product_sku');
      const sku = `PRD-${String(seq).padStart(4, '0')}`;
      // brand/type NOT NULL tanpa default di Supabase — Flutter mengirim ''.
      const product = await tx.product.create({
        data: { ...dto, brand: dto.brand ?? '', type: dto.type ?? '', sku },
      });
      return toJson(product);
    });
  }

  async findAll() {
    const products = await this.prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    return products.map(toJson);
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');
    return toJson(product);
  }

  async update(id: string, dto: UpdateProductDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Produk tidak ditemukan');

    const product = await this.prisma.product.update({ where: { id }, data: dto });
    await this.prisma.auditLog.create({
      data: { actorUid: actorId, action: 'product.update', target: id, detail: { ...dto } as Prisma.InputJsonValue },
    });
    return toJson(product);
  }
}
