import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

interface ProductPriceAgg {
  totalStock: number;
  sellPriceMin: number | null;
  sellPriceMax: number | null;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
  ) {}

  /**
   * `sku` (kode pendek "PRD-0001", dst) digenerate otomatis di sini pakai
   * counter GLOBAL (bukan di-scope per-tanggal kayak barcode unit AC —
   * produk gak dibuat sesering itu, jadi nomor jalan terus aja tanpa reset
   * harian). Dibungkus $transaction biar counter & product.create()
   * atomic — kalau create gagal, nomor sku-nya ikut rollback, gak "bolong".
   */
  create(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      const seq = await this.counters.nextSeq(tx, 'product_sku');
      const sku = `PRD-${String(seq).padStart(4, '0')}`;
      return tx.product.create({ data: { ...dto, sku, active: true } });
    });
  }

  /** Harga & stok produk sekarang agregat dari batch aktif (item_costs,
   * kind='product', stock>0) — Siklus batch-cost 2026-09. */
  private async priceAggFor(productIds: string[]): Promise<Map<string, ProductPriceAgg>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      { ref_id: string; total_stock: string; min_price: string; max_price: string }[]
    >`
      SELECT ref_id, SUM(stock) AS total_stock, MIN(sell_price) AS min_price, MAX(sell_price) AS max_price
      FROM item_costs
      WHERE kind = 'product' AND stock > 0 AND ref_id = ANY(${productIds})
      GROUP BY ref_id
    `;
    return new Map(
      rows.map((r) => [r.ref_id, { totalStock: Number(r.total_stock), sellPriceMin: Number(r.min_price), sellPriceMax: Number(r.max_price) }]),
    );
  }

  async findAll() {
    const products = await this.prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    const agg = await this.priceAggFor(products.map((p) => p.id));
    return products.map((p) => {
      const a = agg.get(p.id);
      return { ...p, stock: a?.totalStock ?? 0, sellPriceMin: a?.sellPriceMin ?? null, sellPriceMax: a?.sellPriceMax ?? null };
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');
    const agg = await this.priceAggFor([id]);
    const a = agg.get(id);
    return { ...product, stock: a?.totalStock ?? 0, sellPriceMin: a?.sellPriceMin ?? null, sellPriceMax: a?.sellPriceMax ?? null };
  }

  /** List batch aktif (stock>0) 1 produk — dipakai dialog pemilihan batch
   * di POS & referensi harga pas stock-in lagi. Urut TERTUA dulu (konsisten
   * sama urutan FIFO di StockLockingService.lockAndDeduct). */
  async findBatches(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');
    return this.prisma.itemCost.findMany({
      where: { kind: 'product', refId: productId, stock: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Edit produk setelah dibuat — gap yang ditemukan di audit migrasi (dulu
   * sama sekali gak ada endpoint update, harga salah ketik gak bisa
   * dibetulin). `stock`/`sellPrice` sengaja bukan bagian dari
   * UpdateProductDto, lihat komentar di sana.
   */
  async update(id: string, dto: UpdateProductDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Produk tidak ditemukan');

    const product = await this.prisma.product.update({ where: { id }, data: dto });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'product.update',
        target: id,
        // Cast — sama gotcha yang udah ketemu berkali-kali di service lain
        // (offline-sync, installation-packages): field2 UpdateProductDto
        // semuanya optional, jadi tipe hasil spread-nya termasuk `undefined`
        // per key, yang ditolak tipe Prisma buat kolom Json. Runtime-nya
        // aman (undefined otomatis ke-drop pas di-serialize ke JSON), ini
        // murni ngakalin type-checker.
        detail: { ...dto } as Prisma.InputJsonValue,
      },
    });

    return product;
  }
}
