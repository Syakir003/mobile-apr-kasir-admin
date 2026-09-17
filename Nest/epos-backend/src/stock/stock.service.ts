import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService } from '../common/services/stock-locking.service';
import { StockInDto } from './dto/stock-in.dto';
import { StockOpnameDto } from './dto/stock-opname.dto';
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';
import { checkBelowCost } from '../common/below-cost.util';
import { ConfirmationRequiredException } from '../common/exceptions/confirmation-required.exception';

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    private stockLocking: StockLockingService,
  ) {}

  /** Barang masuk: sparepart tetap 1 harga (upsert), produk selalu bikin
   * batch (ItemCost) baru + cek warning "jual di bawah modal". */
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

          // Bukan tx.itemCost.upsert({where:{kind_refId:...}}) — PK item_costs
          // sekarang `id` sendiri (Siklus batch-cost 2026-09), `[kind,refId]`
          // cuma @@index biasa (BUKAN @@unique — sengaja, kind='product' HARUS
          // boleh banyak baris per refId buat batch). Prisma gak generate tipe
          // filter compound `kind_refId` dari index biasa, jadi upsert manual.
          //
          // findFirst+create manual TANPA lock itu rawan race (ketemu review
          // 2026-09-08): 2 stockIn sparepart yang sama BARENGAN bisa
          // dua-duanya lolos findFirst (belum ada baris), dua-duanya create
          // -> 2 baris item_costs buat 1 sparepart, ngelanggar invarian
          // "sparepart cuma 1 baris" yang dijaga di kode (bukan constraint DB).
          // pg_advisory_xact_lock kunci per (kind='sparepart', refId) SELAMA
          // transaksi ini — panggilan stockIn sparepart lain buat refId yang
          // sama otomatis NUNGGU sampai transaksi ini commit/rollback, baru
          // findFirst-nya baca data yang udah kebaruan. Lock ke-release
          // otomatis pas transaksi selesai (xact = scoped ke transaksi).
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtext('item_costs_sparepart'), hashtext($1))`,
            dto.refId,
          );
          const existingSparepartCost = await tx.itemCost.findFirst({
            where: { kind: 'sparepart', refId: dto.refId },
          });
          if (existingSparepartCost) {
            await tx.itemCost.update({
              where: { id: existingSparepartCost.id },
              data: { buyPrice: dto.buyPrice },
            });
          } else {
            await tx.itemCost.create({
              data: { kind: 'sparepart', refId: dto.refId, buyPrice: dto.buyPrice, sellPrice: 0, stock: 0 },
            });
          }

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

        // kind === 'product' — selalu bikin batch (item_costs) BARU.
        const sellPrice = dto.sellPrice!; // dijamin ada oleh @ValidateIf di DTO
        const product = await tx.product.findUnique({ where: { id: dto.refId } });
        if (!product) throw new BadRequestException(`Produk ${dto.refId} tidak ditemukan`);

        const { isBelowCost, effectivePrice } = checkBelowCost({ buyPrice: dto.buyPrice, sellPrice });
        if (isBelowCost && !dto.confirmOverride) {
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

        const batch = await tx.itemCost.create({
          data: {
            kind: 'product',
            refId: dto.refId,
            supplierName: dto.supplierName,
            buyPrice: dto.buyPrice,
            sellPrice,
            stock: dto.qty,
          },
        });

        await tx.stockMovement.create({
          data: {
            itemKind: 'product',
            refId: dto.refId,
            name: product.name,
            qtyChange: dto.qty,
            reason: 'barang_masuk',
            createdById: actorId,
            itemCostId: batch.id,
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
              supplierName: dto.supplierName ?? null,
              batchId: batch.id,
              note: dto.note ?? null,
              override: isBelowCost || undefined,
            },
          },
        });

        return {
          kind: 'product' as const,
          batchId: batch.id,
          refId: dto.refId,
          name: product.name,
          qty: dto.qty,
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

  /** Stock opname: koreksi stok LANGSUNG ke angka fisik. Sparepart per-
   * produk (kayak dulu), produk PER-BATCH (item_costs) — produk bisa
   * punya banyak batch aktif sekaligus, jadi opname harus nunjuk batch
   * mana yang dikoreksi (`itemCostId`). */
  async opname(dto: StockOpnameDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // sort dulu (sparepart by refId, produk by itemCostId) — hindari
      // deadlock kalau ada opname/checkout lain jalan barengan.
      const sorted = [...dto.items].sort((a, b) => {
        const keyA = a.kind === 'product' ? a.itemCostId! : a.refId;
        const keyB = b.kind === 'product' ? b.itemCostId! : b.refId;
        return keyA.localeCompare(keyB);
      });

      const results: Array<{
        refId: string;
        itemCostId: string | null;
        name: string;
        systemQty: number;
        physicalQty: number;
        delta: number;
      }> = [];

      for (const item of sorted) {
        if (item.kind === 'sparepart') {
          const rows = await tx.$queryRawUnsafe<{ name: string; stock: unknown }[]>(
            `SELECT name, stock FROM spareparts WHERE id = $1 FOR UPDATE`,
            item.refId,
          );
          const row = rows[0];
          if (!row) throw new BadRequestException(`Item ${item.refId} tidak ditemukan`);

          const systemQty = Number(row.stock);
          const delta = item.physicalQty - systemQty;

          if (delta === 0) {
            results.push({ refId: item.refId, itemCostId: null, name: row.name, systemQty, physicalQty: item.physicalQty, delta: 0 });
            continue;
          }

          await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = $1 WHERE id = $2`, item.physicalQty, item.refId);

          await tx.stockMovement.create({
            data: {
              itemKind: 'sparepart',
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
              detail: { kind: 'sparepart', name: row.name, systemQty, physicalQty: item.physicalQty, delta, note: dto.note ?? null },
            },
          });

          results.push({ refId: item.refId, itemCostId: null, name: row.name, systemQty, physicalQty: item.physicalQty, delta });
          continue;
        }

        // kind === 'product' — koreksi 1 BATCH spesifik.
        const rows = await tx.$queryRawUnsafe<{ name: string; stock: number }[]>(
          `SELECT p.name AS name, ic.stock AS stock
           FROM item_costs ic
           JOIN products p ON p.id = ic.ref_id
           WHERE ic.id = $1 AND ic.kind = 'product'
           FOR UPDATE OF ic`,
          item.itemCostId,
        );
        const row = rows[0];
        if (!row) throw new BadRequestException(`Batch ${item.itemCostId} tidak ditemukan`);

        const systemQty = row.stock;
        const delta = item.physicalQty - systemQty;

        if (delta === 0) {
          results.push({ refId: item.refId, itemCostId: item.itemCostId!, name: row.name, systemQty, physicalQty: item.physicalQty, delta: 0 });
          continue;
        }

        await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = $1 WHERE id = $2`, item.physicalQty, item.itemCostId);

        await tx.stockMovement.create({
          data: {
            itemKind: 'product',
            refId: item.refId,
            name: row.name,
            qtyChange: delta,
            reason: 'opname',
            createdById: actorId,
            itemCostId: item.itemCostId,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'stock.opname',
            target: item.refId,
            detail: { kind: 'product', itemCostId: item.itemCostId, name: row.name, systemQty, physicalQty: item.physicalQty, delta, note: dto.note ?? null },
          },
        });

        results.push({ refId: item.refId, itemCostId: item.itemCostId!, name: row.name, systemQty, physicalQty: item.physicalQty, delta });
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
