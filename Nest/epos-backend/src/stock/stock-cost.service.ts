import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { checkBelowCost } from '../common/below-cost.util';
import { maxKnownCost, toCost } from '../common/cost.util';
import { CostListQueryDto, SetCostDto } from './dto/set-cost.dto';

const SALE_REASONS = ['penjualan', 'pemakaian_instalasi'];

export interface CostRow {
  itemCostIds: string[];
  kind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  buyPrice: number | null;
  sellPrice: number;
  qtyReceived: number | null;
  supplierName: string | null;
  createdAt: Date;
  createdByName: string | null;
}

/**
 * Harga modal per batch: daftar, isi, koreksi (admin). Mengubah harga sekaligus
 * menghitung ulang `invoice_items.buy_price_snapshot` invoice yang terdampak.
 * Spec: docs/superpowers/specs/2026-11-27-gudang-terima-barang-design.md
 */
@Injectable()
export class StockCostService {
  constructor(private prisma: PrismaService) {}

  async list(query: CostListQueryDto): Promise<CostRow[]> {
    // Outdoor paket selalu Rp0 (modal di Indoor) — tidak ditampilkan/diisi.
    const paired = await this.prisma.product.findMany({
      where: { pairedProductId: { not: null } },
      select: { pairedProductId: true },
    });
    const outdoorIds = paired.map((p) => p.pairedProductId as string);
    const costs = await this.prisma.itemCost.findMany({
      where: {
        ...(query.filter === 'all' ? {} : { buyPrice: null }),
        ...(query.refId ? { refId: query.refId } : {}),
        NOT: { kind: 'product', refId: { in: outdoorIds } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    if (costs.length === 0) return [];

    const refIds = [...new Set(costs.map((c) => c.refId))];
    const [products, spareparts, received] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: refIds } } }),
      this.prisma.sparepart.findMany({ where: { id: { in: refIds } } }),
      this.prisma.stockMovement.findMany({
        where: { itemCostId: { in: costs.map((c) => c.id) }, reason: 'barang_masuk' },
        include: { createdBy: { select: { displayName: true } } },
      }),
    ]);
    const items = new Map<string, { name: string; sellPrice: unknown; unit?: string }>(
      [...products, ...spareparts].map((i) => [i.id, i]),
    );
    const receipts = new Map(received.map((m) => [m.itemCostId, m]));

    const rows = new Map<string, CostRow>();
    for (const c of costs) {
      const receipt = receipts.get(c.id);
      const item = items.get(c.refId);
      const row: CostRow = {
        itemCostIds: [c.id],
        kind: c.kind as CostRow['kind'],
        refId: c.refId,
        name: item?.name ?? '(barang terhapus)',
        unit: c.kind === 'product' ? 'unit' : (item?.unit ?? ''),
        buyPrice: toCost(c.buyPrice),
        sellPrice: Number(item?.sellPrice ?? 0),
        qtyReceived: receipt ? Number(receipt.qtyChange) : null,
        supplierName: c.supplierName ?? null,
        createdAt: c.createdAt,
        createdByName: receipt?.createdBy?.displayName ?? null,
      };
      // Gulungan dari satu penerimaan (pemasok, pencatat, menit, harga sama)
      // jadi satu baris supaya cukup diisi sekali.
      const key =
        c.kind === 'sparepart' && receipt
          ? [c.refId, row.supplierName, row.createdByName, c.createdAt.toISOString().slice(0, 16), row.buyPrice].join('|')
          : c.id;
      const group = rows.get(key);
      if (!group) {
        rows.set(key, row);
        continue;
      }
      group.itemCostIds.push(c.id);
      group.qtyReceived = (group.qtyReceived ?? 0) + (row.qtyReceived ?? 0);
    }
    return [...rows.values()];
  }

  async setCost(itemCostId: string, dto: SetCostDto, actorId: string) {
    const ids = [...new Set([itemCostId, ...(dto.alsoItemCostIds ?? [])])];
    return this.prisma.$transaction(
      async (tx) => {
        const target = await tx.itemCost.findUnique({ where: { id: itemCostId } });
        if (!target) throw new NotFoundException('Batch tidak ditemukan');
        const kind = target.kind as CostRow['kind'];
        const refId = target.refId;

        // Kunci DULU (urutan sama dengan checkout: spareparts lalu item_costs)
        // supaya checkout yang sedang jalan selesai sebelum invoice dibaca.
        if (kind === 'sparepart') {
          await tx.$queryRawUnsafe(`SELECT id FROM spareparts WHERE id = $1 FOR UPDATE`, refId);
          await tx.$queryRawUnsafe(`SELECT id FROM item_costs WHERE id = ANY($1) ORDER BY id FOR UPDATE`, ids);
        } else {
          // SEMUA batch produk ini: hitung ulang membaca harga batch lain, jadi
          // dua admin yang menyimpan batch berbeda harus antre.
          await tx.$queryRawUnsafe(
            `SELECT id FROM item_costs WHERE kind = 'product' AND ref_id = $1 ORDER BY id FOR UPDATE`,
            refId,
          );
        }

        const costs = await tx.itemCost.findMany({ where: { id: { in: ids } } });
        if (costs.length !== ids.length || costs.some((c) => c.kind !== kind || c.refId !== refId)) {
          throw new BadRequestException('Semua batch harus milik barang yang sama');
        }

        const sparepart = kind === 'sparepart' ? await tx.sparepart.findUnique({ where: { id: refId } }) : null;
        const product = sparepart ? null : await tx.product.findUnique({ where: { id: refId } });
        const item = sparepart ?? product;
        if (!item) throw new NotFoundException('Barang tidak ditemukan');
        if (kind === 'product' && (await tx.product.count({ where: { pairedProductId: refId } })) > 0) {
          throw new BadRequestException(`${item.name} adalah Outdoor dari paket — modal dicatat di Indoor-nya`);
        }

        const sellPrice = Number(item.sellPrice);
        const { isBelowCost, effectivePrice } = checkBelowCost({ buyPrice: dto.buyPrice, sellPrice });
        if (isBelowCost && !dto.confirmOverride) {
          return {
            status: 'confirm_required' as const,
            warnings: [
              { refId, itemCostId, name: item.name, buyPrice: dto.buyPrice, sellPrice, discount: 0, effectivePrice },
            ],
          };
        }

        const before = costs.find((c) => c.id === itemCostId)!;
        const oldPrice = toCost(before.buyPrice);
        const priceSetAt = before.updatedAt;
        await tx.itemCost.updateMany({
          where: { id: { in: ids } },
          data: {
            buyPrice: dto.buyPrice,
            ...(dto.supplierName === undefined ? {} : { supplierName: dto.supplierName }),
          },
        });

        const packSize = sparepart?.packSize ? Number(sparepart.packSize) : null;
        const sales = await tx.stockMovement.findMany({
          where: { itemCostId: { in: ids }, reason: { in: SALE_REASONS }, transactionId: { not: null } },
        });
        // Sparepart biasa: mutasinya tidak menunjuk batch.
        const invoices =
          sparepart && !sparepart.batchTracked && sales.length === 0
            ? await this.repriceFlat(tx, refId, oldPrice, dto.buyPrice, priceSetAt, packSize)
            : await this.repriceByBatch(tx, kind, refId, sales.map((m) => m.transactionId as string), packSize);

        if (product?.pairedProductId) {
          const since = new Date(Math.min(...costs.map((c) => c.createdAt.getTime())));
          const singles = await this.repricePackageRef(
            tx, [refId, product.pairedProductId], oldPrice, dto.buyPrice, since,
          );
          invoices.push(...singles.filter((n) => !invoices.includes(n)));
        }

        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'stock.set_cost',
            target: refId,
            detail: {
              kind,
              name: item.name,
              itemCostIds: ids,
              oldBuyPrice: oldPrice,
              newBuyPrice: dto.buyPrice,
              invoices,
            },
          },
        });
        return { status: 'ok' as const, updatedInvoiceNumbers: invoices };
      },
      { timeout: 30_000 }, // satu batch bisa menyentuh banyak invoice
    );
  }

  /** Modal baris = harga tertinggi dari SEMUA batch yang diambil transaksi itu. */
  private async repriceByBatch(
    tx: Prisma.TransactionClient,
    kind: CostRow['kind'],
    refId: string,
    transactionIds: string[],
    packSize: number | null,
  ) {
    const changed: string[] = [];
    for (const transactionId of new Set(transactionIds)) {
      const taken = await tx.stockMovement.findMany({
        where: { transactionId, itemKind: kind, refId, reason: { in: SALE_REASONS }, itemCostId: { not: null } },
      });
      const batches = await tx.itemCost.findMany({
        where: { id: { in: taken.map((m) => m.itemCostId as string) } },
      });
      const price = maxKnownCost(batches.map((b) => b.buyPrice));
      const invoice = await tx.invoice.findFirst({ where: { transactionId } });
      if (!invoice) continue;
      const lines = await tx.invoiceItem.findMany({
        where: { invoiceId: invoice.id, refId, kind: { in: lineKinds(kind) }, costUnallocated: false },
      });
      for (const l of lines) {
        const next = perSaleUnit(price, l.saleKind, packSize);
        if (toCost(l.buyPriceSnapshot) === next) continue;
        await tx.invoiceItem.update({ where: { id: l.id }, data: { buyPriceSnapshot: next } });
        if (!changed.includes(invoice.number)) changed.push(invoice.number);
      }
    }
    return changed;
  }

  /** Sparepart biasa: baris sejak harga lama dipasang, yang kosong atau berharga lama. */
  private async repriceFlat(
    tx: Prisma.TransactionClient,
    refId: string,
    oldPrice: number | null,
    newPrice: number,
    since: Date,
    packSize: number | null,
  ) {
    const lines = await tx.invoiceItem.findMany({
      where: {
        refId,
        kind: { in: lineKinds('sparepart') },
        costUnallocated: false,
        invoice: { createdAt: { gte: since } },
      },
      include: { invoice: { select: { number: true } } },
    });
    const changed: string[] = [];
    for (const l of lines) {
      const current = toCost(l.buyPriceSnapshot);
      const next = perSaleUnit(newPrice, l.saleKind, packSize);
      if (current === next) continue;
      if (current !== null && current !== perSaleUnit(oldPrice, l.saleKind, packSize)) continue;
      await tx.invoiceItem.update({ where: { id: l.id }, data: { buyPriceSnapshot: next } });
      if (!changed.includes(l.invoice.number)) changed.push(l.invoice.number);
    }
    return changed;
  }

  /** Unit AC yang dijual satuan: modalnya 0, tetapi `package_cost_ref` dipakai
   * laporan untuk batas bawah laba — ikut diisi/dikoreksi. */
  private async repricePackageRef(
    tx: Prisma.TransactionClient,
    refIds: string[],
    oldPrice: number | null,
    newPrice: number,
    since: Date,
  ) {
    const lines = await tx.invoiceItem.findMany({
      where: { kind: 'product', refId: { in: refIds }, costUnallocated: true, invoice: { createdAt: { gte: since } } },
      include: { invoice: { select: { number: true } } },
    });
    const changed: string[] = [];
    for (const l of lines) {
      const current = toCost(l.packageCostRef);
      // Acuan = modal TERTINGGI: ganti yang kosong/berharga lama; batch yang
      // baru diisi juga boleh menaikkannya.
      const replace =
        current === null || current === oldPrice || (oldPrice === null && newPrice > current);
      if (current === newPrice || !replace) continue;
      await tx.invoiceItem.update({ where: { id: l.id }, data: { packageCostRef: newPrice } });
      if (!changed.includes(l.invoice.number)) changed.push(l.invoice.number);
    }
    return changed;
  }
}

function lineKinds(kind: CostRow['kind']) {
  return kind === 'product' ? ['product'] : ['sparepart', 'installation_package_item'];
}

/** Jual utuh: modal per packUnit (rupiah bulat), sama seperti saat checkout. */
function perSaleUnit(price: number | null, saleKind: string | null, packSize: number | null) {
  return price !== null && saleKind === 'utuh' && packSize ? Math.round(price * packSize) : price;
}
