import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService } from '../common/services/stock-locking.service';
import { SupabaseRpcService, RpcActor } from '../prisma/supabase-rpc.service';
import { StockInDto } from './dto/stock-in.dto';
import { StockOpnameDto } from './dto/stock-opname.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';
import { checkBelowCost } from '../common/below-cost.util';
import { ConfirmationRequiredException } from '../common/exceptions/confirmation-required.exception';

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    private stockLocking: StockLockingService,
    private rpc: SupabaseRpcService,
  ) {}

  /** Padanan `adjustStockCallerProvider` (mobile) — lihat komentar `AdjustStockDto`. */
  adjust(actor: RpcActor, dto: AdjustStockDto) {
    return this.rpc.call(actor, 'adjust_stock', dto);
  }

  /** Barang masuk: sparepart & produk sama-sama 1 baris stok langsung di
   * tabel masing-masing (spareparts.stock / products.stock) — ItemCost
   * cuma nyimpen `buyPrice` (1 baris per kind+refId, ditimpa tiap stock-in),
   * BUKAN lagi per-batch (desain multi-batch dibatalkan, lihat plan.md). */
  async stockIn(dto: StockInDto, actorId: string) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (dto.kind === 'sparepart') {
          const { name, previousStock } = await this.stockLocking.lockAndAdd(tx, dto.refId, dto.qty);

          const movement = await tx.stockMovement.create({
            data: {
              itemKind: dto.kind,
              refId: dto.refId,
              name,
              qtyChange: dto.qty,
              reason: 'barang_masuk',
              createdById: actorId,
            },
          });

          // item_costs PK asli-nya [kind, refId] (composite, beneran unik di
          // DB) — upsert langsung aman & atomik, gak perlu advisory lock
          // manual kayak sebelumnya (itu cuma dibutuhin pas asumsi PK-nya
          // `id` sendiri, yang ternyata gak sesuai schema asli).
          await tx.itemCost.upsert({
            where: { kind_refId: { kind: 'sparepart', refId: dto.refId } },
            create: { kind: 'sparepart', refId: dto.refId, buyPrice: dto.buyPrice },
            update: { buyPrice: dto.buyPrice },
          });

          await tx.auditLog.create({
            data: {
              actorUid: actorId,
              action: 'stock.in',
              target: dto.refId,
              detail: {
                kind: dto.kind,
                name,
                qty: dto.qty,
                buyPrice: dto.buyPrice,
                previousStock,
                note: dto.note ?? null,
              },
            },
          });

          return {
            kind: 'sparepart' as const,
            movementId: movement.id,
            refId: dto.refId,
            name,
            previousStock,
            newStock: previousStock + dto.qty,
          };
        }

        // kind === 'product' — dulu selalu bikin batch (item_costs) baru;
        // schema asli gak punya batch sama sekali, jadi produk sekarang
        // dikunci & ditambah stoknya langsung di tabel products, sama kayak
        // sparepart (StockLockingService.lockAndAdd cuma nyentuh tabel
        // spareparts, jadi lock produk ditulis manual di sini).
        const sellPrice = dto.sellPrice!; // dijamin ada oleh @ValidateIf di DTO

        const rows = await tx.$queryRawUnsafe<{ name: string; stock: number }[]>(
          `SELECT name, stock FROM products WHERE id = $1 FOR UPDATE`,
          dto.refId,
        );
        const product = rows[0];
        if (!product) throw new BadRequestException(`Produk ${dto.refId} tidak ditemukan`);
        const previousStock = Number(product.stock);

        const { isBelowCost, effectivePrice } = checkBelowCost({ buyPrice: dto.buyPrice, sellPrice });
        if (isBelowCost && !dto.confirmOverride) {
          // itemCostId selalu null sekarang — ItemCost gak punya id/batch
          // sendiri lagi buat dirujuk (lihat BelowCostWarning).
          throw new ConfirmationRequiredException([
            {
              refId: dto.refId,
              itemCostId: null,
              name: product.name,
              buyPrice: dto.buyPrice,
              sellPrice,
              discount: 0,
              effectivePrice,
            },
          ]);
        }

        await tx.$executeRawUnsafe(
          `UPDATE products SET stock = stock + $1, sell_price = $2 WHERE id = $3`,
          dto.qty,
          sellPrice,
          dto.refId,
        );

        await tx.itemCost.upsert({
          where: { kind_refId: { kind: 'product', refId: dto.refId } },
          create: { kind: 'product', refId: dto.refId, buyPrice: dto.buyPrice },
          update: { buyPrice: dto.buyPrice },
        });

        const movement = await tx.stockMovement.create({
          data: {
            itemKind: 'product',
            refId: dto.refId,
            name: product.name,
            qtyChange: dto.qty,
            reason: 'barang_masuk',
            createdById: actorId,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'stock.in',
            target: dto.refId,
            detail: {
              kind: 'product',
              name: product.name,
              qty: dto.qty,
              buyPrice: dto.buyPrice,
              sellPrice,
              // supplierName & batchId dulu kolom item_costs (desain batch)
              // — schema asli gak punya keduanya, jadi cuma disimpen di
              // detail JSON audit log ini (buat jejak historis), bukan kolom
              // durable.
              supplierName: dto.supplierName ?? null,
              note: dto.note ?? null,
              override: isBelowCost || undefined,
            },
          },
        });

        return {
          kind: 'product' as const,
          movementId: movement.id,
          refId: dto.refId,
          name: product.name,
          previousStock,
          newStock: previousStock + dto.qty,
          buyPrice: dto.buyPrice,
          sellPrice,
        };
      });
      return { status: 'ok' as const, ...result };
    } catch (err) {
      if (err instanceof ConfirmationRequiredException) {
        return { status: 'confirm_required' as const, warnings: err.warnings };
      }
      throw err;
    }
  }

  /** Stock opname: koreksi stok LANGSUNG ke angka fisik. Sparepart & produk
   * sama-sama per-item (bukan per-batch lagi) — keduanya cuma punya 1 angka
   * stok di tabel masing-masing, jadi cukup dikunci & dikoreksi by refId. */
  async opname(dto: StockOpnameDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // sort by refId — hindari deadlock kalau ada opname/checkout lain
      // jalan barengan (dulu produk disortir by itemCostId, tapi itemCostId
      // udah gak ada lagi karena batch dicabut).
      const sorted = [...dto.items].sort((a, b) => a.refId.localeCompare(b.refId));

      const results: Array<{
        refId: string;
        name: string;
        systemQty: number;
        physicalQty: number;
        delta: number;
      }> = [];

      for (const item of sorted) {
        // 'product' & 'sparepart' sekarang sama-sama 1 baris stok simpel —
        // nama tabel tinggal dipilih sesuai kind (bukan input user, aman
        // diinterpolasi ke SQL).
        const table = item.kind === 'sparepart' ? 'spareparts' : 'products';

        const rows = await tx.$queryRawUnsafe<{ name: string; stock: unknown }[]>(
          `SELECT name, stock FROM ${table} WHERE id = $1 FOR UPDATE`,
          item.refId,
        );
        const row = rows[0];
        if (!row) throw new BadRequestException(`Item ${item.refId} tidak ditemukan`);

        const systemQty = Number(row.stock);
        const delta = item.physicalQty - systemQty;

        if (delta === 0) {
          results.push({ refId: item.refId, name: row.name, systemQty, physicalQty: item.physicalQty, delta: 0 });
          continue;
        }

        await tx.$executeRawUnsafe(`UPDATE ${table} SET stock = $1 WHERE id = $2`, item.physicalQty, item.refId);

        await tx.stockMovement.create({
          data: {
            itemKind: item.kind,
            refId: item.refId,
            name: row.name,
            qtyChange: delta,
            reason: 'opname',
            createdById: actorId,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'stock.opname',
            target: item.refId,
            detail: { kind: item.kind, name: row.name, systemQty, physicalQty: item.physicalQty, delta, note: dto.note ?? null },
          },
        });

        results.push({ refId: item.refId, name: row.name, systemQty, physicalQty: item.physicalQty, delta });
      }

      return results;
    });
  }

  /** Histori keluar-masuk stok — read-only, gabungan dari semua jalur (checkout, servis, barang masuk, opname). */
  async findMovements(query: StockMovementsQueryDto) {
    return this.prisma.stockMovement.findMany({
      where: {
        itemKind: query.itemKind,
        refId: query.refId,
        reason: query.reason,
        createdAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // guard sederhana, cukup buat skala 1 toko — belum perlu pagination formal
    });
  }
}
