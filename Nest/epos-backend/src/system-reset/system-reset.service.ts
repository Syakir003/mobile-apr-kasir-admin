import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ResetDatabaseDto,
  ResetScope,
  RESET_CONFIRM_TEXT,
} from './dto/reset-database.dto';

// Fitur "Zona Bahaya" halaman Pengaturan (2026-09-25) — reset database
// admin-only, 3 tingkat cakupan. Lihat
// docs/superpowers/plans/2026-09-25-reset-database-plan.md untuk alasan
// urutan hapus & keputusan per tabel (kenapa Counter direset granular per
// prefix, kenapa DeviceToken/User/AppConfig gak pernah ikut, dst).
@Injectable()
export class SystemResetService {
  constructor(private readonly prisma: PrismaService) {}

  async reset(dto: ResetDatabaseDto, actorId: string) {
    const expected = RESET_CONFIRM_TEXT[dto.scope];
    if (dto.confirmText !== expected) {
      throw new BadRequestException(
        `Teks konfirmasi salah. Ketik persis: "${expected}"`,
      );
    }

    const deletedCounts: Record<string, number> = {};
    const del = async (
      tx: Prisma.TransactionClient,
      key: string,
      fn: (tx: Prisma.TransactionClient) => Promise<{ count: number }>,
    ) => {
      const result = await fn(tx);
      deletedCounts[key] = result.count;
    };

    const resetAt = await this.prisma.$transaction(
      async (tx) => {
        // ---- Tier 1: Transaksi & histori bisnis — SEMUA scope ----
        await del(tx, 'jobFindingPhoto', (t) => t.jobFindingPhoto.deleteMany());
        await del(tx, 'jobFinding', (t) => t.jobFinding.deleteMany());
        await del(tx, 'jobPhoto', (t) => t.jobPhoto.deleteMany());
        await del(tx, 'materialRequestItem', (t) => t.materialRequestItem.deleteMany());
        await del(tx, 'invoiceAdjustment', (t) => t.invoiceAdjustment.deleteMany());
        await del(tx, 'manualPayment', (t) => t.manualPayment.deleteMany());
        await del(tx, 'materialRequest', (t) => t.materialRequest.deleteMany());
        await del(tx, 'technicianJob', (t) => t.technicianJob.deleteMany());
        await del(tx, 'serviceOrderUnit', (t) => t.serviceOrderUnit.deleteMany());
        await del(tx, 'serviceOrder', (t) => t.serviceOrder.deleteMany());
        await del(tx, 'invoiceItem', (t) => t.invoiceItem.deleteMany());
        await del(tx, 'whatsappLog', (t) => t.whatsappLog.deleteMany());
        await del(tx, 'voucher', (t) => t.voucher.deleteMany());
        await del(tx, 'invoice', (t) => t.invoice.deleteMany());
        await del(tx, 'transactionItem', (t) => t.transactionItem.deleteMany());
        await del(tx, 'transaction', (t) => t.transaction.deleteMany());
        await del(tx, 'stockMovement', (t) => t.stockMovement.deleteMany());
        await del(tx, 'cashierShift', (t) => t.cashierShift.deleteMany());
        await del(tx, 'notification', (t) => t.notification.deleteMany());
        // AuditLog LAMA ikut wipe di sini — baris baru yang mendokumentasikan
        // reset ini sendiri ditulis PALING TERAKHIR, di luar helper del()
        // (lihat bawah), jadi selalu jadi satu-satunya sisa setelah reset.
        await del(tx, 'auditLog', (t) => t.auditLog.deleteMany());
        await del(tx, 'syncActionLog', (t) => t.syncActionLog.deleteMany());
        // Counter nomor invoice — aman direset di semua scope karena Invoice
        // di atas SELALU ikut kehapus, jadi gak ada baris lama yang bisa
        // tabrakan nomor sama invoice baru.
        await del(tx, 'counterInvoice', (t) =>
          t.counter.deleteMany({ where: { key: { startsWith: 'invoice_' } } }),
        );

        // ---- Tier 2: Pelanggan & unit AC — scope transaksi_pelanggan, total ----
        if (dto.scope === 'transaksi_pelanggan' || dto.scope === 'total') {
          await del(tx, 'memberAcUnit', (t) => t.memberAcUnit.deleteMany());
          await del(tx, 'member', (t) => t.member.deleteMany());
          // Counter barcode unit AC — cuma aman direset kalau MemberAcUnit
          // ikut kehapus juga (di atas), biar gak ada barcode baru yang
          // tabrakan sama unit lama yang masih ada.
          await del(tx, 'counterAcUnit', (t) =>
            t.counter.deleteMany({ where: { key: { startsWith: 'acunit_' } } }),
          );
        }

        // ---- Tier 3: Master data katalog — scope total doang ----
        if (dto.scope === 'total') {
          // Putusin dulu self-reference pairedProductId sebelum Product
          // dihapus (FK ke Product sendiri).
          await tx.product.updateMany({ data: { pairedProductId: null } });
          await del(tx, 'installationPackageItem', (t) => t.installationPackageItem.deleteMany());
          await del(tx, 'installationPackage', (t) => t.installationPackage.deleteMany());
          await del(tx, 'itemCost', (t) => t.itemCost.deleteMany());
          await del(tx, 'product', (t) => t.product.deleteMany());
          await del(tx, 'sparepart', (t) => t.sparepart.deleteMany());
          await del(tx, 'service', (t) => t.service.deleteMany());
          await del(tx, 'problemCategory', (t) => t.problemCategory.deleteMany());
          // Counter SKU produk — cuma aman direset kalau Product ikut
          // kehapus juga (di atas).
          await del(tx, 'counterProductSku', (t) =>
            t.counter.deleteMany({ where: { key: 'product_sku' } }),
          );
        }

        // ---- Tulis SATU AuditLog baru yang mendokumentasikan reset ini ----
        const summary = await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'system.reset',
            target: dto.scope,
            detail: deletedCounts,
          },
        });

        return summary.at;
      },
      { timeout: 30000 },
    );

    return { scope: dto.scope, deletedCounts, resetAt };
  }
}
