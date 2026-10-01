import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService, LockedItem } from '../common/services/stock-locking.service';
import { CountersService } from '../counters/counters.service';
import { MembersService } from '../members/members.service';
import { AcUnitsService } from '../ac-units/ac-units.service';
import { PairableProduct } from '../ac-units/ac-unit-pair.util';
import { TechnicianJobsService } from '../technician-jobs/technician-jobs.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { CheckoutDto, CheckoutItemDto } from './dto/checkout.dto';
import {
  computeTotals,
  formatInvoiceNumber,
  allocateBatchDeductions,
  findSingleUnitLineIndexes,
  ProductPairInfo,
} from './pos-calc.util';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import { checkBelowCost } from '../common/below-cost.util';
import {
  ConfirmationRequiredException,
  BelowCostWarning,
  SingleUnitWarning,
} from '../common/exceptions/confirmation-required.exception';
import { randomUUID } from 'crypto';

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

/** Key unik per BARIS cart. Siklus harga-seragam (2026-09-22) — produk
 * SEKARANG selalu `product:${refId}` juga (bukan lagi `product:${itemCostId}`)
 * karena checkout udah gak nunjuk batch spesifik lagi (FIFO otomatis lintas
 * batch), jadi 2 baris produk yang sama SEKARANG dianggap 1 baris (kayak
 * sparepart/service dari awal). */
function lineKey(item: { kind: string; refId: string; saleKind?: string | null }): string {
  // Sparepart jual UTUH (2026-09-30) dapet key sendiri biar bisa hidup
  // berdampingan sama baris ECERAN sparepart yang sama di cart yang sama.
  if (item.kind === 'sparepart' && item.saleKind === 'utuh') return `${item.kind}:${item.refId}:utuh`;
  return `${item.kind}:${item.refId}`;
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
   * Siklus harga-seragam (2026-09-22): kind='product' SEKARANG auto-FIFO
   * lintas batch (`StockLockingService.lockAndDeduct`, bukan lagi manual
   * pilih batch lewat `itemCostId`). Harga jual default dari
   * `Product.sellPrice`, tapi tiap baris BOLEH di-override manual
   * (`item.unitPriceOverride`) — kasir bisa nego harga langsung di kasir.
   * Boleh kasih diskon per-baris, dan checkout bisa balik
   * `{status:'confirm_required', warnings}` (HTTP 200, bukan error) kalau
   * ada baris yang harga efektifnya di bawah/pas MAX(buyPrice) batch yang
   * masih berstok DAN request belum bawa `confirmOverride:true` — lihat
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
      if (item.kind === 'sparepart' && item.saleKind === 'utuh' && item.qty !== Math.trunc(item.qty)) {
        throw new BadRequestException('Qty sparepart jual utuh harus bilangan bulat');
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
        // (cegah deadlock). Produk & sparepart sama-sama dikunci per refId
        // sekarang (produk gak lagi per-batch, lihat lineKey).
        const demand = new Map<
          string,
          { kind: 'product' | 'sparepart'; refId: string; qty: number; saleKind?: 'utuh' | 'eceran' | null }
        >();
        for (const item of dto.items) {
          if (item.kind === 'service') continue;
          demand.set(lineKey(item), {
            kind: item.kind,
            refId: item.refId,
            qty: item.qty,
            saleKind: item.kind === 'sparepart' ? (item.saleKind ?? null) : null,
          });
        }
        for (const line of packageLines) {
          if (!line.sparepartId) continue;
          const key = `sparepart:${line.sparepartId}`;
          const d = demand.get(key);
          if (d) d.qty += line.qty;
          else demand.set(key, { kind: 'sparepart', refId: line.sparepartId, qty: line.qty });
        }

        const stockResults = new Map<string, LockedItem>();
        for (const key of [...demand.keys()].sort()) {
          const d = demand.get(key)!;
          const result = await this.stockLocking.lockAndDeduct(tx, d.kind, d.refId, d.qty, d.saleKind);
          stockResults.set(key, result);
        }

        // Paket AC Split (2026-09-30) — baris produk yang dijual SATUAN
        // (Indoor saja / Outdoor saja) dari produk AC berpasangan, BUKAN
        // bagian Split di cart ini. Ditentuin di SERVER dari data pairing
        // (bukan dipercaya dari flag client). Lihat findSingleUnitLineIndexes.
        const productRefIds = [...new Set(dto.items.filter((i) => i.kind === 'product').map((i) => i.refId))];
        const pairInfo = new Map<string, ProductPairInfo>();
        const productNames = new Map<string, string>();
        if (productRefIds.length > 0) {
          const selfRows = await tx.product.findMany({
            where: { id: { in: productRefIds } },
            select: { id: true, name: true, pairedProductId: true, pairedProduct: { select: { name: true } } },
          });
          const indoorOfRows = await tx.product.findMany({
            where: { pairedProductId: { in: productRefIds } },
            select: { id: true, name: true, pairedProductId: true },
          });
          for (const r of selfRows) {
            productNames.set(r.id, r.name);
            if (r.pairedProductId && r.pairedProduct) productNames.set(r.pairedProductId, r.pairedProduct.name);
            pairInfo.set(r.id, { pairedProductId: r.pairedProductId, pairedIndoorId: null });
          }
          for (const r of indoorOfRows) {
            productNames.set(r.id, r.name);
            const info = pairInfo.get(r.pairedProductId!);
            if (info) info.pairedIndoorId = r.id;
          }
        }
        // Audit 2026-09-30 — validasi bundel Split di SERVER (jangan percaya
        // client): baris Outdoor yang nunjuk Indoor harus (a) index valid &
        // bukan diri sendiri, (b) target = produk Indoor yang beneran
        // berpasangan sama Outdoor ini, (c) qty sama persis, (d) satu Indoor
        // cuma boleh dipasangin satu baris Outdoor. Kalau gak, Outdoor bisa
        // "gratis" (harga dipaksa 0) tanpa Indoor.
        const usedIndoorIdx = new Set<number>();
        dto.items.forEach((item, idx) => {
          if (item.pairedWithItemIndex === undefined) return;
          const target = dto.items[item.pairedWithItemIndex];
          const info = target ? pairInfo.get(target.refId) : undefined;
          if (
            !target ||
            item.pairedWithItemIndex === idx ||
            item.kind !== 'product' ||
            target.kind !== 'product' ||
            target.pairedWithItemIndex !== undefined ||
            info?.pairedProductId !== item.refId ||
            target.qty !== item.qty ||
            usedIndoorIdx.has(item.pairedWithItemIndex)
          ) {
            throw new BadRequestException(
              'Baris Split tidak valid: Outdoor harus berpasangan dengan Indoor-nya dan jumlahnya harus sama',
            );
          }
          usedIndoorIdx.add(item.pairedWithItemIndex);
        });

        const singleUnitIndexes = new Set(findSingleUnitLineIndexes(dto.items, pairInfo));
        // Unit satuan dari paket gak punya harga baku: harga WAJIB diisi
        // eksplisit (> 0). Tanpa ini, Indoor saja bisa kejual pakai harga
        // paket penuh atau Outdoor saja Rp0 kalau client gak ngirim override.
        for (const idx of singleUnitIndexes) {
          const it = dto.items[idx];
          if (!(it.unitPriceOverride !== undefined && it.unitPriceOverride > 0)) {
            throw new BadRequestException(
              `Harga jual ${productNames.get(it.refId) ?? 'unit satuan'} wajib diisi (unit satuan dari paket tidak punya harga baku)`,
            );
          }
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
            // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) —
            // baris Outdoor mode "Unit Lengkap" (pairedWithItemIndex keisi)
            // harganya DIPAKSA 0, gak peduli unitPriceOverride yang kekirim
            // (modal/harga jual sepenuhnya nempel ke sisi Indoor).
            const unitPrice =
              item.pairedWithItemIndex !== undefined ? 0 : (item.unitPriceOverride ?? locked.unitPrice);
            // Paket AC Split (2026-09-30) — unit satuan dari paket: modal
            // paket gak dipecah per unit, HPP baris ini SENGAJA 0 (ditandai
            // costUnallocated di invoice_items, lihat di bawah).
            const buyPriceSnapshot = singleUnitIndexes.has(dto.items.indexOf(item)) ? 0 : locked.buyPrice;
            priced.set(lineKey(item), { name: locked.name, unit: locked.unit, unitPrice, buyPriceSnapshot });
          } else {
            // kind === 'sparepart'. Siklus sparepart-per-gulungan
            // (2026-09-23): kalau batchTracked, `locked.batchDeductions`
            // udah keisi (StockLockingService FIFO lintas item_costs) dan
            // `locked.buyPrice` udah MAX dari batch berstok — itemCost.
            // findFirst() DI BAWAH cuma valid buat sparepart FLAT (yang
            // emang cuma punya 1 baris item_costs, invarian lama). Kalau
            // dipaksa dipakai buat batch-tracked, hasilnya sembarang baris
            // (findFirst gak ada ORDER BY eksplisit) — bukan cost yang
            // representatif.
            const locked = stockResults.get(lineKey(item))!;
            let buyPriceSnapshot: number | null;
            if (locked.batchDeductions) {
              buyPriceSnapshot = locked.buyPrice;
            } else {
              const cost = await tx.itemCost.findFirst({ where: { kind: 'sparepart', refId: item.refId } });
              buyPriceSnapshot = cost ? Number(cost.buyPrice) : null;
            }
            // Jual utuh: modal dicatat per packUnit (modal per satuan kecil
            // x packSize), biar cogs = qty x snapshot tetap benar di laporan.
            if (buyPriceSnapshot !== null && locked.qtyMultiplier && locked.qtyMultiplier !== 1) {
              buyPriceSnapshot = Math.round(buyPriceSnapshot * locked.qtyMultiplier); // modal utuh: rupiah bulat (hindari 900000.01 dari pembulatan per-satuan-kecil)
            }
            priced.set(lineKey(item), { ...locked, buyPriceSnapshot });
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
          // Outdoor mode "Unit Lengkap" harganya udah dipaksa 0 di atas —
          // gak mungkin "untung" dan gak relevan dibanding modal, jadi
          // SELALU dilewatin dari warning ini (sesuai spec: Outdoor gak
          // pernah kena warning modal).
          if (item.pairedWithItemIndex !== undefined) continue;
          // Unit satuan dari paket AC dapet konfirmasi sendiri (modal paket,
          // lihat singleUnitWarnings di bawah), bukan warning ini — modal per
          // unit-nya emang gak ada/gak dipecah.
          if (singleUnitIndexes.has(dto.items.indexOf(item))) continue;
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
              // null — checkout sekarang FIFO otomatis lintas batch, gak ada
              // 1 batch spesifik yang "ditunjuk" kasir lagi (beda dari
              // barang masuk yang juga null tapi alasannya "batch belum
              // kebuat").
              itemCostId: null,
              name: p.name,
              buyPrice,
              sellPrice: p.unitPrice,
              discount: Math.round((item.discount ?? 0) + proratedTxDiscount),
              effectivePrice,
            });
          }
        }

        // Paket AC Split (2026-09-30) — konfirmasi "jual 1 unit dari paket":
        // SELALU muncul buat unit satuan (bukan cuma kalau di bawah modal),
        // karena modal restock dicatat per paket & gak dipecah per unit —
        // kasir/owner yang mutusin harganya masuk akal atau enggak. Modal
        // paket = MAX buyPrice batch INDOOR paket itu yang masih ada unitnya
        // (di gudang ATAU lagi di-reserve, termasuk unit yang baru aja
        // di-reserve checkout ini), fallback batch Indoor terbaru.
        const singleUnitWarnings: SingleUnitWarning[] = [];
        const packageCostByIndex = new Map<number, number>();
        for (const idx of singleUnitIndexes) {
          const item = dto.items[idx];
          const info = pairInfo.get(item.refId)!;
          const isIndoor = !!info.pairedProductId;
          const indoorId = isIndoor ? item.refId : info.pairedIndoorId!;
          const outdoorId = isIndoor ? info.pairedProductId! : item.refId;
          const modalRows = await tx.$queryRaw<{ buy_price: string | null }[]>`
            SELECT COALESCE(
              (SELECT MAX(ic.buy_price) FROM item_costs ic
                WHERE ic.kind = 'product' AND ic.ref_id = ${indoorId}
                  AND EXISTS (SELECT 1 FROM stock_units su
                    WHERE su.item_cost_id = ic.id AND su.status IN ('di_gudang', 'reserved'))),
              (SELECT ic.buy_price FROM item_costs ic
                WHERE ic.kind = 'product' AND ic.ref_id = ${indoorId}
                ORDER BY ic.created_at DESC LIMIT 1)
            ) AS buy_price
          `;
          const p = priced.get(lineKey(item))!;
          packageCostByIndex.set(idx, Number(modalRows[0]?.buy_price ?? 0));
          singleUnitWarnings.push({
            refId: item.refId,
            name: p.name,
            unitRole: isIndoor ? 'indoor' : 'outdoor',
            packageName: `${productNames.get(indoorId) ?? '?'} + ${productNames.get(outdoorId) ?? '?'}`,
            packageBuyPrice: Number(modalRows[0]?.buy_price ?? 0),
            sellPrice: p.unitPrice,
            qty: item.qty,
          });
        }

        if ((belowCostWarnings.length > 0 || singleUnitWarnings.length > 0) && !dto.confirmOverride) {
          throw new ConfirmationRequiredException(belowCostWarnings, singleUnitWarnings);
        }

        // Siklus sparepart-per-gulungan (2026-09-23) — buat key yang
        // batchDeductions-nya keisi (produk SELALU, sparepart CUMA kalau
        // batchTracked), pecah alokasi FIFO gabungan balik ke tiap consumer
        // (baris cart item + baris paket instalasi yang sama-sama narik
        // sparepart/produk itu) — biar StockMovement per-baris tetap nunjuk
        // batch/roll yang presisi. Urutan consumer per key: baris cart dulu
        // (kalau ada), baru baris paket (urutan dto.installations) — SAMA
        // urutan yang dipakai 2 loop di bawah, jadi split di sini konsisten
        // sama urutan movement yang bakal dibuat.
        type MovementConsumer =
          | { source: 'item'; item: (typeof dto.items)[number] }
          | { source: 'package'; line: PackageChargeLine };
        const batchSplitsByKey = new Map<
          string,
          { meta: MovementConsumer; itemCostId: string; qty: number }[]
        >();
        {
          const consumersByKey = new Map<string, { qty: number; meta: MovementConsumer }[]>();
          for (const item of dto.items) {
            if (item.kind === 'service') continue;
            const key = lineKey(item);
            const arr = consumersByKey.get(key) ?? [];
            // qty dalam SATUAN KECIL (jual utuh: qty x packSize) — sama
            // dengan satuan batchDeductions dari StockLockingService.
            arr.push({ qty: item.qty * (stockResults.get(key)?.qtyMultiplier ?? 1), meta: { source: 'item', item } });
            consumersByKey.set(key, arr);
          }
          for (const line of packageLines) {
            if (!line.sparepartId) continue;
            const key = `sparepart:${line.sparepartId}`;
            const arr = consumersByKey.get(key) ?? [];
            arr.push({ qty: line.qty, meta: { source: 'package', line } });
            consumersByKey.set(key, arr);
          }
          for (const [key, consumers] of consumersByKey) {
            const deductions = stockResults.get(key)?.batchDeductions;
            if (!deductions) continue; // produk selalu ada, sparepart cuma kalau batchTracked
            batchSplitsByKey.set(key, allocateBatchDeductions(consumers, deductions));
          }
        }

        // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) — 1
        // pairGroupId per PASANGAN (dikunci dari index baris Outdoor-nya,
        // karena cuma Outdoor yang bawa pairedWithItemIndex), dipasang ke
        // StockMovement baris Indoor MAUPUN Outdoor yang bersangkutan.
        const pairGroupIdByItemIndex = new Map<number, string>();
        dto.items.forEach((item, idx) => {
          if (item.pairedWithItemIndex === undefined) return;
          const groupId = randomUUID();
          pairGroupIdByItemIndex.set(idx, groupId);
          pairGroupIdByItemIndex.set(item.pairedWithItemIndex, groupId);
        });

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
              saleKind: item.kind === 'sparepart' ? (item.saleKind ?? null) : null,
            },
          });
          if (item.kind !== 'service') {
            // Siklus sparepart-per-gulungan (2026-09-23): produk SELALU
            // FIFO (batchSplitsByKey selalu keisi), sparepart cuma keisi
            // kalau batchTracked=true — sparepart flat jatuh ke cabang
            // `else` (1 StockMovement gabungan, TANPA itemCostId, perilaku
            // lama gak berubah).
            //
            // Filter `meta.source==='item' && meta.item===item` WAJIB —
            // batchSplitsByKey per key bisa berisi GABUNGAN split milik
            // consumer 'item' INI dan consumer 'package' (paket instalasi
            // yang kebetulan pakai sparepart yang sama, lihat Step 3). Tanpa
            // filter ini, splits milik paket bakal ikut ke-loop DI SINI
            // JUGA (dobel-hitung) — bagiannya cuma boleh dieksekusi sekali,
            // di loop paket (Step 5).
            const splits = batchSplitsByKey
              .get(lineKey(item))
              ?.filter((s) => s.meta.source === 'item' && s.meta.item === item);
            const itemIndex = dto.items.indexOf(item);
            if (splits && splits.length > 0) {
              for (const s of splits) {
                await tx.stockMovement.create({
                  data: {
                    itemKind: item.kind,
                    refId: item.refId,
                    name: p.name,
                    qtyChange: -s.qty,
                    reason: 'penjualan',
                    transactionId: transaction.id,
                    createdById: actorId,
                    itemCostId: s.itemCostId,
                    pairGroupId: pairGroupIdByItemIndex.get(itemIndex) ?? null,
                  },
                });
              }
            } else {
              await tx.stockMovement.create({
                data: {
                  itemKind: item.kind,
                  refId: item.refId,
                  name: p.name,
                  qtyChange: -item.qty * (stockResults.get(lineKey(item))?.qtyMultiplier ?? 1),
                  reason: 'penjualan',
                  transactionId: transaction.id,
                  createdById: actorId,
                  pairGroupId: pairGroupIdByItemIndex.get(itemIndex) ?? null,
                },
              });
            }
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
            const key = `sparepart:${line.sparepartId}`;
            const splits = batchSplitsByKey.get(key)?.filter(
              (s) => s.meta.source === 'package' && s.meta.line === line,
            );
            if (splits && splits.length > 0) {
              for (const s of splits) {
                await tx.stockMovement.create({
                  data: {
                    itemKind: 'sparepart',
                    refId: line.sparepartId,
                    name: line.name,
                    qtyChange: -s.qty,
                    reason: 'pemakaian_instalasi',
                    transactionId: transaction.id,
                    createdById: actorId,
                    itemCostId: s.itemCostId,
                  },
                });
              }
            } else {
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

        // Siklus QR per-unit (2026-09-30) — StockLockingService udah
        // mereservasi StockUnit yang relevan (status='reserved') pas lock
        // stok di atas, TAPI belum tau invoice mana yang mereservasi (invoice
        // ini baru aja lahir). Tandain di sini, SEKALI, gabungan dari SEMUA
        // baris produk (termasuk pasangan Indoor+Outdoor mode Lengkap — dua-
        // duanya sama-sama nyumbang reservedUnitIds sendiri-sendiri).
        const allReservedUnitIds = [...stockResults.values()].flatMap((r) => r.reservedUnitIds ?? []);
        if (allReservedUnitIds.length > 0) {
          await tx.stockUnit.updateMany({
            where: { id: { in: allReservedUnitIds } },
            data: { reservedForInvoiceId: invoice.id },
          });
        }

        for (const [itemIndex, item] of dto.items.entries()) {
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
              costUnallocated: singleUnitIndexes.has(itemIndex),
              packageCostRef: packageCostByIndex.get(itemIndex) ?? null,
              saleKind: item.kind === 'sparepart' ? (item.saleKind ?? null) : null,
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
        const assignedJobs: { jobId: string; technicianId: string | null }[] = [];
        if (dto.installations?.length) {
          const order = await tx.serviceOrder.create({
            data: { memberId: member.id, transactionId: transaction.id, invoiceId: invoice.id, type: 'pemasangan', status: 'terjadwal', createdById: actorId },
          });
          serviceOrderId = order.id;

          for (let idx = 0; idx < dto.installations.length; idx++) {
            const inst = dto.installations[idx];
            if (inst.itemIndexes.length > 2) {
              throw new BadRequestException('itemIndexes instalasi maksimal 2 (Indoor + Outdoor)');
            }
            const products: PairableProduct[] = [];
            for (const itemIdx of inst.itemIndexes) {
              const item = dto.items[itemIdx];
              if (!item || item.kind !== 'product') {
                throw new BadRequestException('itemIndexes instalasi harus menunjuk item bertipe product');
              }
              const productData = await tx.product.findUnique({ where: { id: item.refId } });
              if (!productData) throw new BadRequestException(`Produk ${item.refId} tidak ditemukan saat proses instalasi`);
              products.push(productData);
            }
            const unit = await this.acUnits.createForInstallation(tx, member.id, products, inst.roomLocation);
            installedUnits.push({ unitId: unit.id, barcodeValue: unit.barcodeValue, roomLocation: unit.roomLocation });
            await tx.serviceOrderUnit.create({ data: { orderId: order.id, unitId: unit.id, status: 'menunggu_pemasangan' } });
            const job = await this.technicianJobs.createForOrder(tx, {
              orderId: order.id,
              memberId: member.id,
              unitId: unit.id,
              technicianId: inst.technicianId ?? null,
              type: 'pemasangan',
              actorId,
            });
            assignedJobs.push({ jobId: job.id, technicianId: job.technicianId });
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
              singleUnitSales: singleUnitWarnings.length || undefined,
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
          assignedJobs,
          voucherDiscountAmount: appliedVoucher ? voucherDiscountAmount : undefined,
          // Ditambah buat POS pay-immediately (frontend auto-panggil
          // POST /invoices/:id/payments abis checkout sukses) — grandTotal
          // WAJIB dari server, bukan preview client, karena diskon voucher
          // cuma keitung final di sini (lihat komentar taxBase/grandTotal
          // preview di pos/page.tsx yang eksplisit bilang gak bisa dipercaya).
          grandTotal: totals.grandTotal,
        };
      });
      return { status: 'ok' as const, ...result };
    } catch (err) {
      if (err instanceof ConfirmationRequiredException) {
        return {
          status: 'confirm_required' as const,
          warnings: err.warnings,
          singleUnitWarnings: err.singleUnitWarnings,
        };
      }
      throw err;
    }
  }
}
