import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService } from '../common/services/stock-locking.service';
import { CountersService } from '../counters/counters.service';
import { MembersService } from '../members/members.service';
import { AcUnitsService } from '../ac-units/ac-units.service';
import { TechnicianJobsService } from '../technician-jobs/technician-jobs.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { CheckoutDto, CheckoutItemDto } from './dto/checkout.dto';
import { computeTotals, formatInvoiceNumber } from './pos-calc.util';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import { checkBelowCost } from '../common/below-cost.util';
import { ConfirmationRequiredException, BelowCostWarning } from '../common/exceptions/confirmation-required.exception';

type PackageWithItems = Prisma.InstallationPackageGetPayload<{
  include: { items: true };
}>;

interface PackageChargeLine {
  instIndex: number;
  sparepartId: string | null;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  buyPriceSnapshot: number | null;
}

/** Key unik per BARIS cart. Sebelum Siklus batch-cost, `${kind}:${refId}`
 * cukup (1 baris = 1 produk). Sekarang 2 baris produk BISA punya refId
 * sama tapi beda batch (itemCostId) — jadi produk kunci pakai itemCostId,
 * bukan refId, biar 2 baris begitu gak numpuk/ketimpa di Map manapun. */
function lineKey(item: { kind: string; refId: string; itemCostId?: string }): string {
  return item.kind === 'product' ? `product:${item.itemCostId}` : `${item.kind}:${item.refId}`;
}

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockLocking: StockLockingService,
    private readonly counters: CountersService,
    private readonly members: MembersService,
    private readonly acUnits: AcUnitsService,
    private readonly technicianJobs: TechnicianJobsService,
    private readonly vouchers: VouchersService,
  ) {}

  /**
   * Port 1:1 dari checkout_transaction RPC (pos_functions.sql) + tambahan
   * lock-urut-refId (cegah deadlock antar checkout paralel) — lihat versi
   * lama buat histori lengkap.
   *
   * Siklus batch-cost (2026-09): kasir sekarang manual milih BATCH
   * (`itemCostId`) buat tiap baris `kind='product'` (bukan cuma refId
   * produk), boleh kasih diskon per-baris, dan checkout bisa balik
   * `{status:'confirm_required', warnings}` (HTTP 200, bukan error) kalau
   * ada baris yang harga efektifnya di bawah/pas modal batch itu DAN
   * request belum bawa `confirmOverride:true` — lihat
   * `ConfirmationRequiredException`.
   */
  async checkout(dto: CheckoutDto, actorId: string) {
    if ((dto.discount ?? 0) > 0 && !dto.discountReason?.trim()) {
      throw new BadRequestException('Alasan diskon wajib diisi kalau ada diskon');
    }

    const seen = new Set<string>();
    for (const item of dto.items) {
      const key = lineKey(item);
      if (seen.has(key)) throw new BadRequestException('Item duplikat');
      seen.add(key);
      if (item.kind === 'product' && item.qty !== Math.trunc(item.qty)) {
        throw new BadRequestException('Qty produk harus bilangan bulat');
      }
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const member = dto.customer.memberId
          ? await tx.member.findUnique({ where: { id: dto.customer.memberId } })
          : (await this.members.findOrCreate(tx, dto.customer.name, dto.customer.phone, dto.customer.address)).member;
        if (!member) throw new NotFoundException('Member yang dipilih tidak ditemukan');

        const packageIds = [
          ...new Set((dto.installations ?? []).map((i) => i.packageId).filter((id): id is string => !!id)),
        ];
        const packages = new Map<string, PackageWithItems>();
        for (const pkgId of packageIds) {
          const pkg = await tx.installationPackage.findUnique({ where: { id: pkgId }, include: { items: true } });
          if (!pkg || !pkg.active) throw new BadRequestException(`Paket instalasi ${pkgId} tidak ditemukan/nonaktif`);
          packages.set(pkgId, pkg);
        }

        const packageLines: PackageChargeLine[] = [];
        (dto.installations ?? []).forEach((inst, idx) => {
          if (!inst.packageId) return;
          const pkg = packages.get(inst.packageId)!;
          for (const item of pkg.items) {
            packageLines.push({
              instIndex: idx,
              sparepartId: item.sparepartId,
              name: item.name,
              unit: item.unit,
              qty: Number(item.qty),
              unitPrice: Number(item.extraPricePerUnit),
              buyPriceSnapshot: null,
            });
          }
        });
        for (const line of packageLines) {
          if (!line.sparepartId) continue;
          const cost = await tx.itemCost.findFirst({ where: { kind: 'sparepart', refId: line.sparepartId } });
          line.buyPriceSnapshot = cost ? Number(cost.buyPrice) : null;
        }

        // Gabung SEMUA kebutuhan lock stok jadi satu peta, di-lock urut key
        // (cegah deadlock). Produk dikunci per BATCH (itemCostId), sparepart
        // per refId (cart + packageLines digabung, kayak sebelumnya).
        const demand = new Map<
          string,
          { kind: 'product' | 'sparepart'; refId: string; itemCostId?: string; qty: number }
        >();
        for (const item of dto.items) {
          if (item.kind === 'service') continue;
          demand.set(lineKey(item), {
            kind: item.kind,
            refId: item.refId,
            itemCostId: item.itemCostId,
            qty: item.qty,
          });
        }
        for (const line of packageLines) {
          if (!line.sparepartId) continue;
          const key = `sparepart:${line.sparepartId}`;
          const d = demand.get(key);
          if (d) d.qty += line.qty;
          else demand.set(key, { kind: 'sparepart', refId: line.sparepartId, qty: line.qty });
        }

        const stockResults = new Map<string, { name: string; unit: string; unitPrice: number; buyPrice: number | null }>();
        for (const key of [...demand.keys()].sort()) {
          const d = demand.get(key)!;
          const result =
            d.kind === 'product'
              ? await this.stockLocking.lockAndDeductProductBatch(tx, d.itemCostId!, d.qty)
              : await this.stockLocking.lockAndDeduct(tx, 'sparepart', d.refId, d.qty);
          stockResults.set(key, result);
        }

        const priced = new Map<
          string,
          { name: string; unit: string; unitPrice: number; buyPriceSnapshot: number | null }
        >();
        for (const item of dto.items) {
          if (item.kind === 'service') {
            const svc = await tx.service.findUnique({ where: { id: item.refId } });
            if (!svc || !svc.active) throw new BadRequestException('Jasa tidak ditemukan/nonaktif');
            priced.set(lineKey(item), { name: svc.name, unit: 'jasa', unitPrice: Number(svc.basePrice), buyPriceSnapshot: null });
          } else if (item.kind === 'product') {
            const locked = stockResults.get(lineKey(item))!;
            priced.set(lineKey(item), { name: locked.name, unit: locked.unit, unitPrice: locked.unitPrice, buyPriceSnapshot: locked.buyPrice });
          } else {
            const locked = stockResults.get(lineKey(item))!;
            const cost = await tx.itemCost.findFirst({ where: { kind: 'sparepart', refId: item.refId } });
            priced.set(lineKey(item), { ...locked, buyPriceSnapshot: cost ? Number(cost.buyPrice) : null });
          }
        }

        // Voucher & totals DIPINDAH ke atas (sebelum cek below-cost) — bug
        // ketemu 2026-09-15: kasir taruh diskon gede di field diskon
        // TRANSAKSI (dto.discount, bukan diskon per-baris item.discount) dan
        // lolos checkout tanpa warning walau harga efektifnya jatuh di
        // bawah/pas modal. Cek below-cost yang lama cuma liat item.discount,
        // gak pernah liat dto.discount/voucherDiscountAmount sama sekali.
        // Rollback tetap aman kalau abis ini ke-abort — semua query di atas
        // (termasuk lock voucher & lock stok) masih di dalam $transaction
        // yang sama, otomatis ke-ROLLBACK.
        let voucherDiscountAmount = 0;
        let appliedVoucher: { voucherId: string; code: string } | null = null;
        if (dto.voucherCode && dto.voucherCode.trim()) {
          // Basis minPurchase/persen SAMA kayak v_subtotal di
          // checkout_transaction RPC: cuma dari items (qty*unitPrice),
          // TANPA package add-on & TANPA dikurangi diskon apapun dulu.
          const rawItemsSubtotal = dto.items.reduce(
            (sum, i) => sum + Math.round(i.qty * priced.get(lineKey(i))!.unitPrice),
            0,
          );
          const result = await this.vouchers.lockAndValidateCode(tx, dto.voucherCode, member.id, rawItemsSubtotal);
          voucherDiscountAmount = result.discountAmount;
          appliedVoucher = { voucherId: result.voucherId, code: dto.voucherCode.trim().toUpperCase() };
        }
        const totalDiscount = (dto.discount ?? 0) + voucherDiscountAmount;

        const totals = computeTotals(
          [
            ...dto.items.map((i) => ({ qty: i.qty, unitPrice: priced.get(lineKey(i))!.unitPrice, discount: i.discount ?? 0 })),
            ...packageLines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
          ],
          totalDiscount,
          dto.taxPercent ?? 0,
          dto.transportFee ?? 0,
        );
        if (totalDiscount > totals.subtotal) {
          throw new BadRequestException('Total diskon (ad-hoc + voucher) melebihi subtotal');
        }

        // Cek "jual di bawah modal" — CUMA buat kind='product'. Diskon
        // transaksi (dto.discount) & voucher ngurangin taxBase SEKALI secara
        // global (lihat computeTotals), bukan per-baris — jadi biar apple-
        // to-apple, di-prorata dulu ke tiap baris PRODUK proporsional ke
        // porsi baris itu di subtotal, baru ditambah ke diskon per-baris
        // (item.discount) buat dibandingin ke buyPrice. Sparepart/jasa ikut
        // "menanggung" porsi diskon transaksi juga secara matematis (subtotal
        // mereka ikut jadi pembagi), tapi cuma baris produk yang di-cek —
        // sesuai batasan checkBelowCost yang emang cuma berlaku buat produk
        // (lihat komentar checkBelowCost).
        const belowCostWarnings: BelowCostWarning[] = [];
        for (const item of dto.items) {
          if (item.kind !== 'product') continue;
          const p = priced.get(lineKey(item))!;
          const buyPrice = p.buyPriceSnapshot ?? 0;
          const lineAmountAfterItemDiscount = Math.round(item.qty * p.unitPrice) - (item.discount ?? 0);
          const proratedTxDiscount =
            totalDiscount > 0 && totals.subtotal > 0
              ? (lineAmountAfterItemDiscount / totals.subtotal) * totalDiscount
              : 0;
          // `item.discount` + porsi diskon transaksi di atas nominal TOTAL 1
          // baris (lihat CheckoutItemDto & computeTotals — dikurangin SEKALI
          // per baris, bukan dikali qty), sedangkan buyPrice/sellPrice di
          // sini PER-UNIT. checkBelowCost butuh discount PER-UNIT biar
          // apple-to-apple — sebar rata dulu (bug ketemu review 2026-09-08:
          // sebelumnya discount total langsung dikurangkan ke sellPrice
          // per-unit, effectivePrice yang ditampilkan ke kasir jadi salah/
          // ke-warning-in buat qty > 1).
          const discountPerUnit = ((item.discount ?? 0) + proratedTxDiscount) / item.qty;
          const { isBelowCost, effectivePrice } = checkBelowCost({
            buyPrice,
            sellPrice: p.unitPrice,
            discount: discountPerUnit,
          });
          if (isBelowCost) {
            belowCostWarnings.push({
              refId: item.refId,
              itemCostId: item.itemCostId!,
              name: p.name,
              buyPrice,
              sellPrice: p.unitPrice,
              discount: Math.round((item.discount ?? 0) + proratedTxDiscount),
              effectivePrice,
            });
          }
        }
        if (belowCostWarnings.length > 0 && !dto.confirmOverride) {
          throw new ConfirmationRequiredException(belowCostWarnings);
        }

        const transaction = await tx.transaction.create({
          data: {
            memberId: member.id,
            customerName: dto.customer.name,
            customerPhone: member.phone,
            subtotal: totals.subtotal,
            discount: totalDiscount,
            taxPercent: dto.taxPercent ?? 0,
            taxAmount: totals.taxAmount,
            transportFee: dto.transportFee ?? 0,
            grandTotal: totals.grandTotal,
            notes: dto.notes,
            createdById: actorId,
          },
        });

        for (const item of dto.items) {
          const p = priced.get(lineKey(item))!;
          const itemDiscount = item.discount ?? 0;
          const lineTotal = Math.round(item.qty * p.unitPrice) - itemDiscount;
          await tx.transactionItem.create({
            data: {
              transactionId: transaction.id,
              kind: item.kind,
              refId: item.refId,
              name: p.name,
              unit: p.unit,
              qty: item.qty,
              unitPrice: p.unitPrice,
              lineTotal,
              discount: itemDiscount,
            },
          });
          if (item.kind !== 'service') {
            await tx.stockMovement.create({
              data: {
                itemKind: item.kind,
                refId: item.refId,
                name: p.name,
                qtyChange: -item.qty,
                reason: 'penjualan',
                transactionId: transaction.id,
                createdById: actorId,
                itemCostId: item.kind === 'product' ? item.itemCostId : undefined,
              },
            });
          }
        }

        for (const line of packageLines) {
          const lineTotal = Math.round(line.qty * line.unitPrice);
          await tx.transactionItem.create({
            data: {
              transactionId: transaction.id,
              kind: 'installation_package_item',
              refId: line.sparepartId,
              name: line.name,
              unit: line.unit,
              qty: line.qty,
              unitPrice: line.unitPrice,
              lineTotal,
            },
          });
          if (line.sparepartId) {
            await tx.stockMovement.create({
              data: {
                itemKind: 'sparepart',
                refId: line.sparepartId,
                name: line.name,
                qtyChange: -line.qty,
                reason: 'pemakaian_instalasi',
                transactionId: transaction.id,
                createdById: actorId,
              },
            });
          }
        }

        const dateKey = this.counters.dateKey(now);
        const invoiceSeq = await this.counters.nextSeq(tx, `invoice_${dateKey}`);
        const invoice = await tx.invoice.create({
          data: {
            number: formatInvoiceNumber(dateKey, invoiceSeq),
            transactionId: transaction.id,
            memberId: member.id,
            customerName: dto.customer.name,
            customerPhone: member.phone,
            subtotal: totals.subtotal,
            discount: totalDiscount,
            taxPercent: dto.taxPercent ?? 0,
            taxAmount: totals.taxAmount,
            transportFee: dto.transportFee ?? 0,
            grandTotal: totals.grandTotal,
            totalPaid: 0,
            status: computeInvoiceStatus(totals.grandTotal, 0),
            notes: dto.notes,
            createdById: actorId,
          },
        });

        for (const item of dto.items) {
          const p = priced.get(lineKey(item))!;
          const itemDiscount = item.discount ?? 0;
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              kind: item.kind,
              refId: item.refId,
              name: p.name,
              unit: p.unit,
              qty: item.qty,
              unitPrice: p.unitPrice,
              lineTotal: Math.round(item.qty * p.unitPrice) - itemDiscount,
              discount: itemDiscount,
              buyPriceSnapshot: p.buyPriceSnapshot,
            },
          });
        }
        for (const line of packageLines) {
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              kind: 'installation_package_item',
              refId: line.sparepartId,
              name: line.name,
              unit: line.unit,
              qty: line.qty,
              unitPrice: line.unitPrice,
              lineTotal: Math.round(line.qty * line.unitPrice),
              buyPriceSnapshot: line.buyPriceSnapshot,
            },
          });
        }
        if ((dto.discount ?? 0) > 0) {
          await tx.invoiceAdjustment.create({
            data: { invoiceId: invoice.id, amount: dto.discount!, reason: dto.discountReason!, createdById: actorId },
          });
        }
        if (appliedVoucher) {
          await tx.invoiceAdjustment.create({
            data: { invoiceId: invoice.id, amount: voucherDiscountAmount, reason: `Voucher: ${appliedVoucher.code}`, createdById: actorId },
          });
          // Voucher ditandai 'terpakai' HANYA setelah invoice lahir, dalam
          // transaksi yang sama — kalau langkah setelahnya gagal, seluruh
          // transaksi (termasuk ini) rollback (sama pola kayak
          // checkout_transaction RPC).
          await tx.voucher.update({
            where: { id: appliedVoucher.voucherId },
            data: { status: 'terpakai', usedAt: now, usedInInvoiceId: invoice.id },
          });
        }

        let serviceOrderId: string | null = null;
        const installedUnits: { unitId: string; barcodeValue: string; roomLocation: string | null }[] = [];
        if (dto.installations?.length) {
          const order = await tx.serviceOrder.create({
            data: { memberId: member.id, transactionId: transaction.id, invoiceId: invoice.id, type: 'pemasangan', status: 'terjadwal', createdById: actorId },
          });
          serviceOrderId = order.id;

          for (let idx = 0; idx < dto.installations.length; idx++) {
            const inst = dto.installations[idx];
            const item = dto.items[inst.itemIndex];
            if (!item || item.kind !== 'product') {
              throw new BadRequestException('itemIndex instalasi harus menunjuk item bertipe product');
            }
            const productData = await tx.product.findUnique({ where: { id: item.refId } });
            if (!productData) throw new BadRequestException(`Produk ${item.refId} tidak ditemukan saat proses instalasi`);
            const unit = await this.acUnits.createForInstallation(tx, member.id, productData, inst.roomLocation);
            installedUnits.push({ unitId: unit.id, barcodeValue: unit.barcodeValue, roomLocation: unit.roomLocation });
            await tx.serviceOrderUnit.create({ data: { orderId: order.id, unitId: unit.id, status: 'menunggu_pemasangan' } });
            await this.technicianJobs.createForOrder(tx, {
              orderId: order.id,
              memberId: member.id,
              unitId: unit.id,
              technicianId: inst.technicianId ?? null,
              type: 'pemasangan',
              actorId,
            });
          }
          await tx.member.update({ where: { id: member.id }, data: { totalAcUnits: { increment: dto.installations.length } } });
        }

        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'pos.checkout',
            target: invoice.id,
            detail: {
              number: invoice.number,
              grandTotal: totals.grandTotal,
              voucherApplied: appliedVoucher?.code ?? null,
              installationPackagesUsed: packageIds.length,
              belowCostOverride: belowCostWarnings.length > 0 || undefined,
            },
          },
        });

        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          transactionId: transaction.id,
          memberId: member.id,
          serviceOrderId,
          installedUnits,
          voucherDiscountAmount: appliedVoucher ? voucherDiscountAmount : undefined,
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
}
