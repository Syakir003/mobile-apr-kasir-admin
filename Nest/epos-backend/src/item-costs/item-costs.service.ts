import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CostKind = 'product' | 'sparepart';
export const COST_KINDS = { product: 'product', sparepart: 'sparepart' } as const;

/**
 * Harga modal (`item_costs`, 1 baris per (kind, refId)) — pengganti
 * `item_cost_repository.dart`. Supabase tidak punya RPC untuk tabel ini
 * (Flutter menulis langsung lewat RLS admin-only, migrasi 0021), jadi
 * ditulis TS di sini; otorisasinya WAJIB admin-only di controller karena
 * Prisma jalan sebagai owner (bypass RLS).
 */
@Injectable()
export class ItemCostsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Semua harga modal satu jenis: { [refId]: buyPrice } (Flutter fetchAll). */
  async findAll(kind: CostKind): Promise<Record<string, number>> {
    const rows = await this.prisma.itemCost.findMany({ where: { kind }, select: { refId: true, buyPrice: true } });
    return Object.fromEntries(rows.map((r) => [r.refId, r.buyPrice]));
  }

  /** Harga modal satu barang; buyPrice 0 bila belum pernah diisi (Flutter fetch). */
  async findOne(kind: CostKind, refId: string) {
    const row = await this.prisma.itemCost.findUnique({ where: { kind_refId: { kind, refId } } });
    return { kind, refId, buyPrice: row?.buyPrice ?? 0, updatedAt: row?.updatedAt ?? null };
  }

  /** Upsert harga modal (Flutter save). updatedAt diisi otomatis (@updatedAt). */
  async save(kind: CostKind, refId: string, buyPrice: number) {
    // item_costs.ref_id tak punya FK — cek manual supaya tak lahir baris yatim.
    const exists =
      kind === 'product'
        ? await this.prisma.product.count({ where: { id: refId } })
        : await this.prisma.sparepart.count({ where: { id: refId } });
    if (!exists) throw new NotFoundException(`${kind === 'product' ? 'Produk' : 'Sparepart'} tidak ditemukan`);
    return this.prisma.itemCost.upsert({
      where: { kind_refId: { kind, refId } },
      create: { kind, refId, buyPrice },
      update: { buyPrice },
    });
  }
}
