import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScanUnitDto } from './dto/scan-unit.dto';
import { ManualFulfillDto } from './dto/manual-fulfill.dto';

/**
 * Siklus QR per-unit (2026-09-30) — "Kasir Scan". Checkout POS gak lagi
 * langsung ngeluarin stok Produk secara fisik: dia cuma REZERVASI unit
 * (StockUnit.status='reserved', ditandain invoiceId-nya — lihat
 * PosService.checkout & StockLockingService.lockAndDeduct). Modul ini
 * ngurus tahap KEDUA — konfirmasi fisik unit mana yang beneran keluar dari
 * gudang, lewat scan QR (kamera) atau ceklist manual (fallback kalau QR
 * rusak/gak kebaca). BARU di titik INI stok resmi "abis" (status 'keluar').
 */
type LockedUnit = {
  id: string;
  ref_id: string;
  item_cost_id: string;
  unit_code: string;
  status: string;
  reserved_for_invoice_id: string | null;
};

@Injectable()
export class KasirScanService {
  constructor(private readonly prisma: PrismaService) {}

  /** Daftar invoice yang masih punya unit 'reserved' (belum full di-scan/ceklist). */
  async listPending() {
    const rows = await this.prisma.$queryRaw<
      { invoice_id: string; number: string; customer_name: string | null; created_at: Date; pending_lines: bigint }[]
    >`
      SELECT i.id AS invoice_id, i.number, i.customer_name, i.created_at,
             COUNT(DISTINCT su.ref_id) AS pending_lines
      FROM stock_units su
      JOIN invoices i ON i.id = su.reserved_for_invoice_id
      WHERE su.status = 'reserved'
      GROUP BY i.id, i.number, i.customer_name, i.created_at
      ORDER BY i.created_at ASC
    `;
    return rows.map((r) => ({
      invoiceId: r.invoice_id,
      invoiceNumber: r.number,
      customerName: r.customer_name,
      createdAt: r.created_at,
      pendingLines: Number(r.pending_lines),
    }));
  }

  /** Detail 1 invoice — per baris produk: qtyTotal (jumlah unit yang
   * direservasi pas checkout), qtyFulfilled (udah discan/diceklist),
   * qtyRemaining. Baris qtyRemaining=0 gak perlu discan lagi. */
  async getInvoiceFulfillment(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice tidak ditemukan');

    const rows = await this.prisma.$queryRaw<
      { ref_id: string; product_name: string; qty_total: bigint; qty_fulfilled: bigint }[]
    >`
      SELECT su.ref_id, p.name AS product_name,
             COUNT(*) AS qty_total,
             COUNT(*) FILTER (WHERE su.status = 'keluar') AS qty_fulfilled
      FROM stock_units su
      JOIN products p ON p.id = su.ref_id
      WHERE su.reserved_for_invoice_id = ${invoiceId}
      GROUP BY su.ref_id, p.name
      ORDER BY p.name ASC
    `;

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      customerName: invoice.customerName,
      lines: rows.map((r) => ({
        refId: r.ref_id,
        productName: r.product_name,
        qtyTotal: Number(r.qty_total),
        qtyFulfilled: Number(r.qty_fulfilled),
        qtyRemaining: Number(r.qty_total) - Number(r.qty_fulfilled),
      })),
    };
  }

  /** Scan QR fisik — token dicari langsung, gak perlu milih baris dulu (itu
   * yang bikin scan lebih cepet daripada ceklist manual).
   *
   * Aturan (revisi 2026-10-01, kondisi lapangan): reservasi FIFO pas checkout
   * cuma "jatah hitungan", BUKAN unit fisik yang wajib diambil. Gudang boleh
   * scan unit `di_gudang` MANA PUN asal produk (refId) sama dengan salah satu
   * baris invoice — sistem nuker reservasinya: unit yang discan jadi `keluar`
   * buat invoice ini, unit yang tadinya direservasi dilepas balik `di_gudang`. */
  async scanUnit(dto: ScanUnitDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.stockUnit.findUnique({ where: { qrToken: dto.qrToken } });
      if (!found) throw new BadRequestException('QR ini gak dikenali sistem');

      const rows = await tx.$queryRawUnsafe<LockedUnit[]>(
        `SELECT id, ref_id, item_cost_id, unit_code, status, reserved_for_invoice_id
         FROM stock_units WHERE id = $1 FOR UPDATE`,
        found.id,
      );
      const unit = rows[0];
      if (!unit) throw new BadRequestException('Unit tidak ditemukan');

      // Unit ini memang jatah invoice ini — jalur lama.
      if (unit.reserved_for_invoice_id === dto.invoiceId) {
        return this.fulfillUnit(tx, unit.id, dto.invoiceId, actorId, 'scan');
      }
      if (unit.status === 'keluar') {
        throw new BadRequestException('Unit ini udah pernah dikeluarkan (invoice lain)');
      }
      if (unit.status === 'reserved') {
        const other = unit.reserved_for_invoice_id
          ? await tx.invoice.findUnique({ where: { id: unit.reserved_for_invoice_id }, select: { number: true } })
          : null;
        throw new BadRequestException(
          `Unit ini udah direservasi buat invoice ${other?.number ?? 'lain'} — ambil unit lain yang setipe`,
        );
      }
      return this.swapAndFulfill(tx, unit, dto.invoiceId, actorId);
    });
  }

  /** Unit `di_gudang` yang discan nggantiin 1 unit `reserved` invoice ini
   * (produk sama). Prioritas unit yang dilepas: yang sebatch sama unit
   * discan (biar catatan modal/batch gak bergeser), kalau gak ada baru yang
   * tertua. */
  private async swapAndFulfill(
    tx: Prisma.TransactionClient,
    scanned: LockedUnit,
    invoiceId: string,
    actorId: string,
  ) {
    const reservedRows = await tx.$queryRawUnsafe<LockedUnit[]>(
      `SELECT id, ref_id, item_cost_id, unit_code, status, reserved_for_invoice_id
       FROM stock_units
       WHERE reserved_for_invoice_id = $1 AND ref_id = $2 AND status = 'reserved'
       ORDER BY (item_cost_id = $3) DESC, created_at ASC
       LIMIT 1 FOR UPDATE`,
      invoiceId,
      scanned.ref_id,
      scanned.item_cost_id,
    );
    const released = reservedRows[0];
    if (!released) {
      const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n FROM stock_units WHERE reserved_for_invoice_id = $1 AND ref_id = $2`,
        invoiceId,
        scanned.ref_id,
      );
      throw new BadRequestException(
        Number(n) > 0
          ? 'Semua unit produk ini di invoice ini udah selesai discan'
          : 'Produk dari unit ini bukan bagian dari invoice ini',
      );
    }

    await tx.stockUnit.update({
      where: { id: released.id },
      data: { status: 'di_gudang', reservedForInvoiceId: null, reservedAt: null },
    });
    const now = new Date();
    await tx.stockUnit.update({
      where: { id: scanned.id },
      data: { status: 'keluar', reservedForInvoiceId: invoiceId, reservedAt: now, soldAt: now },
    });

    if (released.item_cost_id !== scanned.item_cost_id) {
      await this.shiftMovementBatch(tx, invoiceId, scanned.ref_id, released.item_cost_id, scanned.item_cost_id);
    }

    await tx.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'kasir_scan.fulfill',
        target: scanned.id,
        detail: {
          invoiceId,
          refId: scanned.ref_id,
          method: 'scan',
          swapped: true,
          releasedUnitId: released.id,
          releasedUnitCode: released.unit_code,
          batchChanged: released.item_cost_id !== scanned.item_cost_id,
        },
      },
    });

    return {
      status: 'ok' as const,
      refId: scanned.ref_id,
      stockUnitId: scanned.id,
      unitCode: scanned.unit_code,
      swapped: true,
      releasedUnitCode: released.unit_code,
    };
  }

  /** Pindahin 1 unit catatan StockMovement penjualan invoice ini dari batch
   * `from` ke batch `to` — biar laporan stok per batch ikut unit yang BENERAN
   * keluar. (buyPriceSnapshot invoice sengaja gak diubah: itu MAX modal semua
   * batch, skenario terburuk, bukan modal batch tertentu.) */
  private async shiftMovementBatch(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    refId: string,
    fromItemCostId: string,
    toItemCostId: string,
  ) {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { transactionId: true } });
    if (!invoice?.transactionId) return;
    const base = { transactionId: invoice.transactionId, itemKind: 'product', refId, reason: 'penjualan' };

    const from = await tx.stockMovement.findFirst({ where: { ...base, itemCostId: fromItemCostId } });
    if (!from) return; // data lama tanpa atribusi batch — gak ada yang digeser

    if (Number(from.qtyChange) <= -2) {
      await tx.stockMovement.update({ where: { id: from.id }, data: { qtyChange: { increment: 1 } } });
    } else {
      await tx.stockMovement.delete({ where: { id: from.id } });
    }

    const to = await tx.stockMovement.findFirst({ where: { ...base, itemCostId: toItemCostId } });
    if (to) {
      await tx.stockMovement.update({ where: { id: to.id }, data: { qtyChange: { decrement: 1 } } });
    } else {
      await tx.stockMovement.create({
        data: {
          itemKind: 'product',
          refId,
          name: from.name,
          qtyChange: -1,
          reason: 'penjualan',
          transactionId: from.transactionId,
          itemCostId: toItemCostId,
          pairGroupId: from.pairGroupId,
          createdById: from.createdById,
        },
      });
    }
  }

  /** Fallback manual — gak butuh tau unit spesifik, sistem ambil 1 unit
   * 'reserved' TERTUA buat (invoice, refId) itu (FIFO, sama prinsip kayak
   * StockLockingService). */
  async manualFulfill(dto: ManualFulfillDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM stock_units
         WHERE reserved_for_invoice_id = $1 AND ref_id = $2 AND status = 'reserved'
         ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
        dto.invoiceId,
        dto.refId,
      );
      const unit = rows[0];
      if (!unit) {
        throw new BadRequestException('Gak ada unit tersisa yang perlu dikeluarin buat baris ini');
      }
      return this.fulfillUnit(tx, unit.id, dto.invoiceId, actorId, 'manual');
    });
  }

  private async fulfillUnit(
    tx: Prisma.TransactionClient,
    stockUnitId: string,
    invoiceId: string,
    actorId: string,
    method: 'scan' | 'manual',
  ) {
    const rows = await tx.$queryRawUnsafe<
      { id: string; ref_id: string; status: string; reserved_for_invoice_id: string | null }[]
    >(
      `SELECT id, ref_id, status, reserved_for_invoice_id FROM stock_units WHERE id = $1 FOR UPDATE`,
      stockUnitId,
    );
    const unit = rows[0];
    if (!unit) throw new BadRequestException('Unit tidak ditemukan');
    if (unit.reserved_for_invoice_id !== invoiceId) {
      throw new BadRequestException('Unit ini bukan bagian dari invoice ini');
    }
    if (unit.status === 'keluar') {
      throw new BadRequestException('Unit ini udah pernah dikeluarkan sebelumnya');
    }
    if (unit.status !== 'reserved') {
      throw new BadRequestException('Unit ini belum direservasi buat invoice manapun');
    }

    await tx.stockUnit.update({
      where: { id: unit.id },
      data: { status: 'keluar', soldAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'kasir_scan.fulfill',
        target: unit.id,
        detail: { invoiceId, refId: unit.ref_id, method },
      },
    });

    return { status: 'ok' as const, refId: unit.ref_id, stockUnitId: unit.id };
  }
}
