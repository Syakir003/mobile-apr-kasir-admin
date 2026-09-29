import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRpcService } from '../prisma/supabase-rpc.service';
import { MembersService } from '../members/members.service';
import { CountersService } from '../counters/counters.service';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CheckoutDto } from './dto/checkout.dto';
import { computeTotals, formatInvoiceNumber } from './pos-calc.util';

export interface CheckoutResult {
  invoiceId: string;
  invoiceNumber: string;
  memberId: string;
  transactionId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Status HTTP sama dengan toHttpException() untuk error RPC. */
function fail(message: string): never {
  if (/^Hanya\b/i.test(message) || /bukan (milik|hak)/i.test(message))
    throw new ForbiddenException(message);
  if (/tidak ditemukan/i.test(message)) throw new NotFoundException(message);
  throw new BadRequestException(message);
}

/** Port 1:1 service_job_type() (migrasi 0015). */
export function serviceJobType(category: string | null | undefined): string {
  switch ((category ?? '').trim().toLowerCase()) {
    case 'cuci':
    case 'cuci ac':
      return 'cuci';
    case 'maintenance':
    case 'perawatan':
      return 'maintenance';
    case 'pindah':
    case 'bongkar pasang':
    case 'bongkar_pasang':
      return 'bongkar_pasang';
    case 'bongkar':
      return 'bongkar';
    default:
      return 'service';
  }
}

interface Line {
  kind: 'product' | 'sparepart' | 'service';
  refId: string;
  qty: number;
  name: string;
  unit: string;
  price: number;
  lineTotal: number;
  category: string;
  brand: string;
  type: string;
  pk: number;
}

@Injectable()
export class PosService {
  constructor(
    private readonly rpc: SupabaseRpcService,
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly counters: CountersService,
  ) {}

  /** Default checkoutNative(); `POS_CHECKOUT_MODE=rpc` -> RPC
   * `checkout_transaction` (migrasi 0030) sebagai jalur cadangan. Payload &
   * response dua-duanya sama, jadi web & mobile gak perlu tahu mode mana
   * yang jalan. */
  checkout(
    dto: CheckoutDto,
    actor: CurrentUserPayload,
  ): Promise<CheckoutResult> {
    if (process.env.POS_CHECKOUT_MODE === 'rpc')
      return this.rpc.call<CheckoutResult>(actor, 'checkout_transaction', dto);
    return this.checkoutNative(dto, actor);
  }

  /**
   * Port TypeScript dari RPC `checkout_transaction` (migrasi 0030) —
   * urutan validasi, pesan error, lock baris, dan data yang ditulis sama.
   * Role admin/kasir + akun aktif sudah dicek JwtStrategy/RolesGuard
   * (padanan assert_caller_role). Beda yang disengaja: HP yang habis
   * dinormalisasi jadi kosong dapet sentinel unik (MembersService.findOrCreate),
   * bukan phone ''.
   */
  async checkoutNative(
    dto: CheckoutDto,
    actor: CurrentUserPayload,
  ): Promise<CheckoutResult> {
    const customer = dto.customer;
    if (!customer?.name?.trim()) fail('Nama pelanggan wajib diisi');
    if (!customer.phone?.trim()) fail('Nomor telepon wajib diisi');

    const items = dto.items ?? [];
    if (items.length < 1) fail('Minimal 1 item wajib diisi');
    const seen = new Set<string>();
    for (const item of items) {
      if (!item.refId) fail('refId item wajib diisi');
      if (!(item.qty > 0)) fail('Qty item harus lebih dari 0');
      if (item.kind === 'product' && !Number.isInteger(item.qty))
        fail('Qty produk harus bilangan bulat');
      const key = `${item.kind}:${item.refId}`;
      if (seen.has(key)) fail('Item duplikat');
      seen.add(key);
      if (!UUID.test(item.refId)) fail(`Item ${item.refId} tidak ditemukan`);
    }

    if (dto.discount !== undefined && dto.discount < 0)
      fail('Diskon tidak valid');
    if (
      dto.taxPercent !== undefined &&
      (dto.taxPercent < 0 || dto.taxPercent > 100)
    ) {
      fail('Pajak harus di rentang 0-100%');
    }
    if (dto.transportFee !== undefined && dto.transportFee < 0)
      fail('Ongkos transport tidak valid');
    const manualDiscount = Math.round(dto.discount ?? 0);
    const taxPercent = dto.taxPercent ?? 0;
    const transportFee = Math.round(dto.transportFee ?? 0);
    const notes = dto.notes ?? null;
    const voucherCode = dto.voucherCode?.trim() || null;

    const installations = dto.installations ?? [];
    const instCount = items.map(() => 0);
    for (const inst of installations) {
      if (
        !Number.isInteger(inst.itemIndex) ||
        inst.itemIndex < 0 ||
        inst.itemIndex >= items.length
      ) {
        fail('itemIndex pemasangan tidak valid');
      }
      if (items[inst.itemIndex].kind !== 'product')
        fail('Pemasangan hanya berlaku untuk item produk AC');
      instCount[inst.itemIndex]++;
    }
    if (instCount.some((n, i) => n > items[i].qty))
      fail('Jumlah pemasangan melebihi qty item');

    const serviceUnits = dto.serviceUnits ?? [];
    const svcCount = items.map(() => 0);
    const seenSvc = new Set<string>();
    for (const svc of serviceUnits) {
      if (
        !Number.isInteger(svc.itemIndex) ||
        svc.itemIndex < 0 ||
        svc.itemIndex >= items.length
      ) {
        fail('itemIndex unit servis tidak valid');
      }
      if (items[svc.itemIndex].kind !== 'service')
        fail('Unit servis hanya berlaku untuk item jasa');
      if (!svc.unitId?.trim()) fail('unitId wajib diisi');
      if (!UUID.test(svc.unitId)) fail('Unit AC tidak ditemukan');
      const key = `${svc.itemIndex}:${svc.unitId.toLowerCase()}`;
      if (seenSvc.has(key)) fail('Unit AC terpilih ganda pada satu jasa');
      seenSvc.add(key);
      svcCount[svc.itemIndex]++;
    }
    if (svcCount.some((n, i) => n > items[i].qty))
      fail('Jumlah unit servis melebihi qty jasa');

    const nInst = installations.length;
    const actorId = actor.sub;

    return this.prisma.$transaction(
      async (tx) => {
        // ---------------------------------------------- baca master + lock stok
        const lines: Line[] = [];
        for (const item of items) {
          let row:
            | {
                name: string;
                active: boolean;
                stock: unknown;
                price: number;
                brand: string;
                type: string;
                pk: unknown;
                unit: string;
                category: string;
              }
            | undefined;
          if (item.kind === 'product') {
            [row] = await tx.$queryRaw<NonNullable<typeof row>[]>`
              SELECT name, active, stock, sell_price AS price, brand, type, pk, 'unit' AS unit, '' AS category
              FROM products WHERE id = ${item.refId}::uuid FOR UPDATE`;
          } else if (item.kind === 'sparepart') {
            [row] = await tx.$queryRaw<NonNullable<typeof row>[]>`
              SELECT name, active, stock, sell_price AS price, '' AS brand, '' AS type, 0 AS pk, unit, '' AS category
              FROM spareparts WHERE id = ${item.refId}::uuid FOR UPDATE`;
          } else {
            const sv = await tx.service.findUnique({
              where: { id: item.refId },
            });
            if (sv) {
              row = {
                name: sv.name,
                active: sv.active,
                stock: null,
                price: sv.basePrice,
                brand: '',
                type: '',
                pk: 0,
                unit: 'jasa',
                category: sv.category,
              };
            }
          }
          if (!row) fail(`Item ${item.refId} tidak ditemukan`);
          if (row.active === false) fail(`${row.name} tidak aktif`);
          if (item.kind !== 'service' && Number(row.stock ?? 0) < item.qty)
            fail(`Stok ${row.name} tidak cukup`);
          lines.push({
            kind: item.kind,
            refId: item.refId,
            qty: item.qty,
            name: row.name,
            unit: row.unit ?? '',
            price: row.price,
            lineTotal: Math.round(item.qty * row.price),
            category: row.category ?? '',
            brand: row.brand ?? '',
            type: row.type ?? '',
            pk: Number(row.pk ?? 0),
          });
        }

        // ---------------------------------------------- teknisi
        const techIds = new Set(
          [...installations, ...serviceUnits]
            .map((x) => x.technicianId)
            .filter((t): t is string => !!t),
        );
        for (const tid of techIds) {
          const tech = UUID.test(tid)
            ? await tx.user.findUnique({ where: { id: tid } })
            : null;
          if (!tech || tech.role !== 'teknisi' || tech.active !== true)
            fail('Teknisi tidak valid atau tidak aktif');
        }

        const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

        // ---------------------------------------------- member (cari/buat)
        const { member } = await this.members.findOrCreate(
          tx,
          customer.name,
          customer.phone,
          customer.address,
        );
        if (nInst > 0) {
          await tx.member.update({
            where: { id: member.id },
            data: { totalAcUnits: { increment: nInst } },
          });
        }

        // ---------------------------------------------- voucher
        let voucherId: string | null = null;
        let voucherDiscount = 0;
        if (voucherCode) {
          const [v] = await tx.$queryRaw<
            {
              id: string;
              member_id: string;
              discount_type: string;
              discount_value: number;
              max_discount_cap: number | null;
              min_purchase: number | null;
              expires_at: Date;
              status: string;
            }[]
          >`SELECT id, member_id, discount_type, discount_value, max_discount_cap, min_purchase, expires_at, status
            FROM vouchers WHERE code = ${voucherCode.toUpperCase()} FOR UPDATE`;
          if (!v) fail('Kode voucher tidak ditemukan');
          if (v.status !== 'aktif') fail(`Voucher ini sudah ${v.status}`);
          if (v.expires_at < new Date()) fail('Voucher ini sudah kedaluwarsa');
          if (v.member_id !== member.id)
            fail('Kode voucher ini bukan milik pelanggan ini');
          if (v.min_purchase !== null && subtotal < v.min_purchase) {
            fail(
              `Belanja belum mencapai minimal Rp ${v.min_purchase} untuk voucher ini`,
            );
          }
          voucherId = v.id;
          voucherDiscount =
            v.discount_type === 'nominal'
              ? v.discount_value
              : Math.min(
                  Math.round((subtotal * v.discount_value) / 100),
                  v.max_discount_cap ?? subtotal,
                );
        }

        // ---------------------------------------------- total
        const discount = manualDiscount + voucherDiscount;
        if (discount > subtotal) fail('Diskon melebihi subtotal');
        const totals = computeTotals(
          lines.map((l) => ({ qty: l.qty, unitPrice: l.price })),
          discount,
          taxPercent,
          transportFee,
        );

        // ---------------------------------------------- nomor invoice
        const dateKey = this.counters.dateKey(new Date());
        const invoiceNumber = formatInvoiceNumber(
          dateKey,
          await this.counters.nextSeq(tx, `invoice_${dateKey}`),
        );

        // ---------------------------------------------- tulis transaksi
        const money = {
          memberId: member.id,
          customerName: customer.name,
          customerPhone: this.members.normalizePhone(customer.phone),
          subtotal: totals.subtotal,
          discount,
          taxPercent,
          taxAmount: totals.taxAmount,
          transportFee,
          grandTotal: totals.grandTotal,
          notes,
          createdById: actorId,
        };
        const transaction = await tx.transaction.create({ data: money });
        const invoice = await tx.invoice.create({
          data: {
            ...money,
            number: invoiceNumber,
            transactionId: transaction.id,
            totalPaid: 0,
            status: 'belum_dibayar',
          },
        });

        if (voucherId) {
          await tx.voucher.update({
            where: { id: voucherId },
            data: {
              status: 'terpakai',
              usedAt: new Date(),
              usedInTransactionId: transaction.id,
            },
          });
        }

        for (const l of lines) {
          const itemRow = {
            kind: l.kind,
            refId: l.refId,
            name: l.name,
            unit: l.unit,
            qty: l.qty,
            unitPrice: l.price,
            lineTotal: l.lineTotal,
          };
          await tx.transactionItem.create({
            data: { ...itemRow, transactionId: transaction.id },
          });
          await tx.invoiceItem.create({
            data: { ...itemRow, invoiceId: invoice.id },
          });

          if (l.kind === 'service') continue;
          await tx.stockMovement.create({
            data: {
              itemKind: l.kind,
              refId: l.refId,
              name: l.name,
              qtyChange: -l.qty,
              reason: 'penjualan',
              transactionId: transaction.id,
              createdById: actorId,
            },
          });
          if (l.kind === 'product') {
            await tx.product.update({
              where: { id: l.refId },
              data: { stock: { decrement: l.qty } },
            });
          } else {
            await tx.sparepart.update({
              where: { id: l.refId },
              data: { stock: { decrement: l.qty } },
            });
          }
        }

        const jobBase = {
          memberId: member.id,
          scheduledDate: null,
          createdById: actorId,
        };
        const orderBase = {
          memberId: member.id,
          transactionId: transaction.id,
          invoiceId: invoice.id,
          status: 'terjadwal',
          createdById: actorId,
        };

        // ---------------------------------------------- pemasangan
        if (nInst > 0) {
          const order = await tx.serviceOrder.create({
            data: { ...orderBase, type: 'pemasangan' },
          });
          for (const inst of installations) {
            const l = lines[inst.itemIndex];
            const seq = await this.counters.nextSeq(tx, `acunit_${dateKey}`);
            const unit = await tx.memberAcUnit.create({
              data: {
                memberId: member.id,
                brand: l.brand,
                model: l.type,
                pk: l.pk,
                roomLocation: inst.roomLocation ?? '',
                barcodeValue: `ACUNIT-${dateKey}-${String(seq).padStart(4, '0')}`,
                serialNumber: null,
                status: 'menunggu_pemasangan',
              },
            });
            await tx.serviceOrderUnit.create({
              data: {
                orderId: order.id,
                unitId: unit.id,
                status: 'menunggu_pemasangan',
              },
            });
            const tid = inst.technicianId || null;
            await tx.technicianJob.create({
              data: {
                ...jobBase,
                orderId: order.id,
                unitId: unit.id,
                technicianId: tid,
                type: 'pemasangan',
                status: tid ? 'assigned' : 'menunggu_penugasan',
              },
            });
          }
        }

        // ---------------------------------------------- servis unit existing
        const ordersByJobType = new Map<string, string>();
        for (const svc of serviceUnits) {
          const unit = await tx.memberAcUnit.findUnique({
            where: { id: svc.unitId },
            select: { memberId: true },
          });
          if (!unit) fail('Unit AC tidak ditemukan');
          if (unit.memberId !== member.id)
            fail('Unit AC bukan milik pelanggan transaksi ini');

          const jobType = serviceJobType(lines[svc.itemIndex].category);
          let orderId = ordersByJobType.get(jobType);
          if (!orderId) {
            orderId = (
              await tx.serviceOrder.create({
                data: { ...orderBase, type: jobType },
              })
            ).id;
            ordersByJobType.set(jobType, orderId);
          }
          await tx.serviceOrderUnit.create({
            data: { orderId, unitId: svc.unitId, status: 'terjadwal' },
          });
          const tid = svc.technicianId || null;
          await tx.technicianJob.create({
            data: {
              ...jobBase,
              orderId,
              unitId: svc.unitId,
              technicianId: tid,
              type: jobType,
              status: tid ? 'assigned' : 'menunggu_penugasan',
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'pos.checkout',
            target: invoice.id,
            detail: {
              number: invoiceNumber,
              grand_total: totals.grandTotal,
              installJobs: nInst,
              serviceJobs: serviceUnits.length,
              voucherId,
            } satisfies Prisma.InputJsonObject,
          },
        });

        return {
          invoiceId: invoice.id,
          invoiceNumber,
          memberId: member.id,
          transactionId: transaction.id,
        };
      },
      // ponytail: banyak round-trip ke DB cloud per checkout; naikkan kalau keranjang besar timeout.
      { timeout: 30_000 },
    );
  }
}
