import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService } from '../common/services/stock-locking.service';
import { CountersService } from '../counters/counters.service';
import { StockInDto } from './dto/stock-in.dto';
import { StockOpnameDto, OpnameItemDto } from './dto/stock-opname.dto';
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';
import { checkBelowCost } from '../common/below-cost.util';
import { ConfirmationRequiredException } from '../common/exceptions/confirmation-required.exception';

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    private stockLocking: StockLockingService,
    private counters: CountersService,
  ) {}

  /**
   * BARU (Siklus QR per-unit, 2026-09-30) — bikin `qty` baris StockUnit buat
   * 1 batch (ItemCost kind='product') yang baru dibuat. Loop 1-per-1 (bukan
   * createMany) SENGAJA — butuh id/unitCode/qrToken tiap baris (dipakai
   * cetak label langsung abis stock-in), dan qty per barang-masuk normalnya
   * kecil (satuan/puluhan unit AC, bukan ribuan), jadi N query gak masalah
   * performa.
   */
  private async generateStockUnits(
    tx: Prisma.TransactionClient,
    itemCostId: string,
    refId: string,
    sku: string | null,
    qty: number,
  ) {
    const created: { id: string; unitCode: string; qrToken: string }[] = [];
    for (let i = 0; i < qty; i++) {
      const seq = await this.counters.nextSeq(tx, `stock_unit_${refId}`);
      const unitCode = `${sku ?? refId.slice(0, 8)}-U${String(seq).padStart(4, '0')}`;
      const unit = await tx.stockUnit.create({
        data: {
          itemCostId,
          refId,
          unitCode,
          qrToken: randomUUID(),
          status: 'di_gudang',
        },
      });
      created.push({ id: unit.id, unitCode: unit.unitCode, qrToken: unit.qrToken });
    }
    return created;
  }

  /** Barang masuk: sparepart FLAT tetap 1 harga (upsert, perilaku lama).
   * Sparepart BATCH-TRACKED (Siklus sparepart-per-gulungan 2026-09-23) bikin
   * N baris item_costs baru (1 per gulungan/`dto.rolls[]`) + StockMovement
   * per gulungan, sinkron mirror `spareparts.stock`. Produk selalu bikin
   * batch (ItemCost) baru + cek warning "jual di bawah modal". */
  async stockIn(dto: StockInDto, actorId: string) {
    // DTO cuma nge-Min(0) qty (mode pairMode='lengkap' boleh Indoor 0) —
    // semua mode lain tetap harus > 0.
    const allowsZeroQty = dto.kind === 'product' && dto.pairMode === 'lengkap';
    if (dto.qty !== undefined && dto.qty <= 0 && !allowsZeroQty) {
      throw new BadRequestException('Qty harus lebih dari 0');
    }
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (dto.kind === 'sparepart') {
          const sparepart = await tx.sparepart.findUnique({ where: { id: dto.refId } });
          if (!sparepart) throw new BadRequestException(`Sparepart ${dto.refId} tidak ditemukan`);

          if (sparepart.batchTracked) {
            if (!dto.rolls?.length) {
              throw new BadRequestException(
                `${sparepart.name} dilacak per-gulungan — isi jumlah & panjang tiap gulungan (rolls)`,
              );
            }
            // Lock baris sparepart DULU (buat mirror stock di bawah) —
            // pola sama kayak lockAndAdd, tapi manual di sini karena kita
            // butuh bikin BANYAK baris item_costs (bukan 1 upsert). SELECT
            // `stock` DI SINI (bukan cuma `SELECT id`) — baca previousStock
            // DI DALAM lock yang sama biar akurat di bawah concurrency, sama
            // pola kayak `lockAndAdd` (beda dari `tx.sparepart.findUnique`
            // di atas yang TANPA lock, cuma buat cek existence/batchTracked/
            // name — stock hasil baca itu BUKAN sumber previousStock lagi).
            const lockedRows = await tx.$queryRawUnsafe<{ stock: unknown }[]>(
              `SELECT stock FROM spareparts WHERE id = $1 FOR UPDATE`,
              dto.refId,
            );
            const previousStock = Number(lockedRows[0].stock);

            let totalQty = 0;
            const batchIds: string[] = [];
            const movementIds: string[] = [];
            for (const roll of dto.rolls) {
              const batch = await tx.itemCost.create({
                data: {
                  kind: 'sparepart',
                  refId: dto.refId,
                  supplierName: dto.supplierName,
                  buyPrice: dto.buyPrice,
                  sellPrice: 0, // placeholder, gak dipakai — sparepart harga jual tetap dari Sparepart.sellPrice
                  stock: roll.length,
                },
              });
              batchIds.push(batch.id);
              totalQty += roll.length;
              const movement = await tx.stockMovement.create({
                data: {
                  itemKind: 'sparepart',
                  refId: dto.refId,
                  name: sparepart.name,
                  qtyChange: roll.length,
                  reason: 'barang_masuk',
                  createdById: actorId,
                  itemCostId: batch.id,
                },
              });
              movementIds.push(movement.id);
            }

            await tx.$executeRawUnsafe(
              `UPDATE spareparts SET stock = stock + $1 WHERE id = $2`,
              totalQty,
              dto.refId,
            );

            await tx.auditLog.create({
              data: {
                actorUid: actorId,
                action: 'stock.in',
                target: dto.refId,
                detail: {
                  kind: dto.kind,
                  name: sparepart.name,
                  rolls: dto.rolls.map((r) => r.length),
                  totalQty,
                  buyPrice: dto.buyPrice,
                  batchIds,
                  movementIds,
                  note: dto.note ?? null,
                },
              },
            });

            return {
              kind: 'sparepart' as const,
              // movementId = StockMovement PERTAMA (1 per roll dibuat di
              // atas) — beda dari sebelumnya yang salah nunjuk `batchIds[0]`
              // (id item_costs, bukan id stock_movements). Konsumen yang
              // butuh SEMUA movement per roll pakai `movementIds` di
              // auditLog.detail di atas, bukan field balikan ini (field ini
              // cuma representatif satu, sama semantik kayak cabang flat
              // di bawah).
              movementId: movementIds[0],
              refId: dto.refId,
              name: sparepart.name,
              previousStock,
              newStock: previousStock + totalQty,
            };
          }

          // Flat (batchTracked=false) — perilaku lama, gak berubah.
          if (dto.qty === undefined) {
            throw new BadRequestException('Qty wajib diisi buat sparepart ini');
          }
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
          // Invarian ini SEKARANG cuma berlaku buat batchTracked=false — lihat
          // cabang batchTracked=true di atas yang SENGAJA bikin banyak baris.
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

        // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) —
        // cabang terpisah, gak numpuk sama alur tunggal di bawah (biar gak
        // nyampur 2 cara nulis batch yang beda banyak: 1 batch vs 2 batch,
        // 1 below-cost check vs 1 below-cost check + 1 yang di-skip).
        if (dto.kind === 'product' && dto.pairMode === 'lengkap') {
          if (dto.qty === undefined) throw new BadRequestException('Qty wajib diisi');
          if (!dto.outdoorRefId) {
            throw new BadRequestException('outdoorRefId wajib diisi buat mode Unit Lengkap');
          }
          // Paket AC Split (2026-09-30) — jumlah Indoor (`qty`) & Outdoor
          // (`outdoorQty`) boleh beda. Modal (`buyPrice`) tetap SATU angka
          // per paket, nempel di batch Indoor; batch Outdoor Rp0.
          const indoorQty = dto.qty;
          const outdoorQty = dto.outdoorQty ?? dto.qty;
          if (indoorQty + outdoorQty <= 0) {
            throw new BadRequestException('Jumlah Indoor atau Outdoor minimal salah satu harus lebih dari 0');
          }
          const indoorProduct = await tx.product.findUnique({ where: { id: dto.refId } });
          if (!indoorProduct) throw new BadRequestException(`Produk ${dto.refId} tidak ditemukan`);
          const outdoorProduct = await tx.product.findUnique({ where: { id: dto.outdoorRefId } });
          if (!outdoorProduct) throw new BadRequestException(`Produk ${dto.outdoorRefId} tidak ditemukan`);
          if (indoorProduct.pairedProductId !== dto.outdoorRefId) {
            throw new BadRequestException(
              `${outdoorProduct.name} bukan Outdoor pasangan ${indoorProduct.name}`,
            );
          }

          const { isBelowCost, effectivePrice } = checkBelowCost({
            buyPrice: dto.buyPrice,
            sellPrice: Number(indoorProduct.sellPrice),
          });
          if (isBelowCost && !dto.confirmOverride) {
            throw new ConfirmationRequiredException([
              {
                refId: dto.refId,
                itemCostId: null,
                name: indoorProduct.name,
                buyPrice: dto.buyPrice,
                sellPrice: Number(indoorProduct.sellPrice),
                discount: 0,
                effectivePrice,
              },
            ]);
          }

          const pairGroupId = randomUUID();

          // Indoor 0 unit (kiriman Outdoor doang) = gak usah bikin batch
          // kosong buat Indoor (sama kayak Outdoor 0 di bawah).
          let indoorBatchId: string | null = null;
          if (indoorQty > 0) {
            const indoorBatch = await tx.itemCost.create({
              data: { kind: 'product', refId: dto.refId, supplierName: dto.supplierName, buyPrice: dto.buyPrice, sellPrice: 0, stock: 0, pairGroupId },
            });
            indoorBatchId = indoorBatch.id;
            await this.generateStockUnits(tx, indoorBatch.id, dto.refId, indoorProduct.sku, indoorQty);
            await tx.stockMovement.create({
              data: { itemKind: 'product', refId: dto.refId, name: indoorProduct.name, qtyChange: indoorQty, reason: 'barang_masuk', createdById: actorId, itemCostId: indoorBatch.id, pairGroupId },
            });
          }

          // Outdoor 0 unit (cuma Indoor yang dateng) = gak usah bikin batch
          // kosong buat Outdoor.
          let outdoorBatchId: string | null = null;
          if (outdoorQty > 0) {
            const outdoorBatch = await tx.itemCost.create({
              data: { kind: 'product', refId: dto.outdoorRefId, supplierName: dto.supplierName, buyPrice: 0, sellPrice: 0, stock: 0, pairGroupId },
            });
            outdoorBatchId = outdoorBatch.id;
            await this.generateStockUnits(tx, outdoorBatch.id, dto.outdoorRefId, outdoorProduct.sku, outdoorQty);
            await tx.stockMovement.create({
              data: { itemKind: 'product', refId: dto.outdoorRefId, name: outdoorProduct.name, qtyChange: outdoorQty, reason: 'barang_masuk', createdById: actorId, itemCostId: outdoorBatch.id, pairGroupId },
            });
          }

          await tx.auditLog.create({
            data: {
              actorUid: actorId,
              action: 'stock.in',
              target: dto.refId,
              detail: {
                kind: 'product', pairMode: 'lengkap', pairGroupId,
                indoor: { refId: dto.refId, name: indoorProduct.name, qty: indoorQty, buyPrice: dto.buyPrice, batchId: indoorBatchId },
                outdoor: { refId: dto.outdoorRefId, name: outdoorProduct.name, qty: outdoorQty, buyPrice: 0, batchId: outdoorBatchId },
                note: dto.note ?? null,
                override: isBelowCost || undefined,
              },
            },
          });

          return {
            kind: 'product' as const,
            batchId: indoorBatchId,
            refId: dto.refId,
            name: indoorProduct.name,
            qty: indoorQty,
            buyPrice: dto.buyPrice,
            pairGroupId,
            outdoorBatchId,
            outdoorQty,
            outdoorName: outdoorProduct.name,
          };
        }

        // kind === 'product' — selalu bikin batch (item_costs) BARU. Siklus
        // harga-seragam (2026-09-22): sellPrice GAK lagi diinput di sini —
        // dibaca dari Product.sellPrice (satu-satunya sumber harga jual
        // produk). Batch baru nulis 0 ke item_costs.sell_price (placeholder,
        // gak dipakai — sama pola kayak kind='sparepart').
        if (dto.qty === undefined) {
          throw new BadRequestException('Qty wajib diisi');
        }
        const product = await tx.product.findUnique({ where: { id: dto.refId } });
        if (!product) throw new BadRequestException(`Produk ${dto.refId} tidak ditemukan`);

        // Outdoor sebuah paket Split gak punya harga jual/modal sendiri
        // (harga satuan diisi kasir pas jual, modal nempel di paket) — jadi
        // GAK kena cek "harga jual di bawah modal".
        const isPackageOutdoor =
          (await tx.product.count({ where: { pairedProductId: product.id } })) > 0;
        if (isPackageOutdoor && dto.buyPrice > 0) {
          throw new BadRequestException(
            `${product.name} adalah Outdoor dari paket — modal dicatat per paket lewat barang masuk paket di halaman Indoor-nya (Outdoor Rp0)`,
          );
        }
        const { isBelowCost, effectivePrice } = isPackageOutdoor
          ? { isBelowCost: false, effectivePrice: Number(product.sellPrice) }
          : checkBelowCost({
              buyPrice: dto.buyPrice,
              sellPrice: Number(product.sellPrice),
            });
        if (isBelowCost && !dto.confirmOverride) {
          throw new ConfirmationRequiredException([
            {
              refId: dto.refId,
              itemCostId: null,
              name: product.name,
              buyPrice: dto.buyPrice,
              sellPrice: Number(product.sellPrice),
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
            sellPrice: 0,
            stock: 0, // placeholder — StockUnit di bawah yang nyimpen jumlah beneran (Siklus QR per-unit)
          },
        });
        await this.generateStockUnits(tx, batch.id, dto.refId, product.sku, dto.qty);

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

  /** Stock opname: koreksi stok LANGSUNG ke angka fisik.
   * - Sparepart FLAT — per-produk (kayak dulu), gak berubah.
   * - Produk — PER-BATCH (item_costs), gak berubah dari Siklus batch-cost.
   * - Sparepart BATCH-TRACKED (BARU, Siklus sparepart-per-gulungan
   *   2026-09-23) — PER-BATCH juga (nunjuk `itemCostId` = roll mana),
   *   sinkron mirror `spareparts.stock` ikut kekoreksi selisihnya. */
  async opname(dto: StockOpnameDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // sort dulu (sparepart flat by refId, produk & sparepart batch-tracked
      // by itemCostId) — hindari deadlock kalau ada opname/checkout lain
      // jalan barengan.
      const sorted = [...dto.items].sort((a, b) => {
        const keyA = a.itemCostId ?? a.refId;
        const keyB = b.itemCostId ?? b.refId;
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
        if (item.kind === 'sparepart' && !item.itemCostId) {
          // Sparepart FLAT — TANPA itemCostId. Kalau ternyata sparepart-nya
          // batchTracked=true tapi request gak ngirim itemCostId, tolak DI
          // SINI (bukan diam-diam dianggap flat) — cek eksplisit di bawah.
          const rows = await tx.$queryRawUnsafe<{ name: string; stock: unknown; batch_tracked: boolean }[]>(
            `SELECT name, stock, batch_tracked FROM spareparts WHERE id = $1 FOR UPDATE`,
            item.refId,
          );
          const row = rows[0];
          if (!row) throw new BadRequestException(`Item ${item.refId} tidak ditemukan`);
          if (row.batch_tracked) {
            throw new BadRequestException(
              `${row.name} dilacak per-gulungan — opname wajib nunjuk itemCostId (roll mana yang dikoreksi)`,
            );
          }

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

        // Siklus QR per-unit (2026-09-30) — item_costs.stock UDAH GAK
        // dipakai lagi buat kind='product' (StockUnit yang sekarang jadi
        // sumber kebenaran), jadi opname per-batch produk di sini gak lagi
        // valid — mengoreksi kolom yang gak dibaca siapa pun. Opname per-unit
        // (misal tandain 1 StockUnit 'hilang'/'rusak') sengaja BELUM
        // dibangun (out of scope spec 2026-09-30), diblokir eksplisit di
        // sini biar gak diam-diam jadi no-op yang bikin bingung.
        if (item.kind === 'product') {
          throw new BadRequestException(
            'Opname produk per-unit belum didukung — fitur stok per-unit fisik belum sampai ke opname',
          );
        }

        // Titik ini SELALU kind === 'sparepart' (batch-tracked) — kind
        // 'product' udah kena throw di guard atas (Siklus QR per-unit,
        // 2026-09-30). Koreksi 1 BATCH/ROLL spesifik.
        if (!item.itemCostId) {
          throw new BadRequestException('itemCostId wajib diisi buat opname sparepart per-batch');
        }

        // Sparepart batch-tracked: kunci baris `spareparts` (buat mirror di
        // bawah) SEBELUM kunci `item_costs` di bawah — urutan ini WAJIB SAMA
        // kayak StockLockingService.lockAndDeduct (spareparts dulu, baru
        // item_costs). Kalau kebalik (item_costs dulu baru spareparts),
        // opname yang jalan BARENGAN sama checkout/markUsed sparepart yang
        // sama bisa DEADLOCK (pola lock ABBA — checkout kunci
        // spareparts->item_costs, kalau opname kunci item_costs->spareparts,
        // dua-duanya bisa saling nunggu). Produk gak punya baris mirror,
        // jadi gak ada lock tambahan buat kind='product' di sini.
        if (item.kind === 'sparepart') {
          await tx.$executeRawUnsafe(`SELECT id FROM spareparts WHERE id = $1 FOR UPDATE`, item.refId);
        }

        // Cuma sparepart yang nyampe sini (lihat komentar di atas), jadi
        // join tabel induknya SELALU `spareparts` — gak perlu ternary lagi
        // kayak sebelum kind='product' diblokir.
        const rows = await tx.$queryRawUnsafe<{ name: string; stock: unknown }[]>(
          `SELECT parent.name AS name, ic.stock AS stock
           FROM item_costs ic
           JOIN spareparts parent ON parent.id = ic.ref_id
           WHERE ic.id = $1 AND ic.kind = $2
           FOR UPDATE OF ic`,
          item.itemCostId,
          item.kind,
        );
        const row = rows[0];
        if (!row) throw new BadRequestException(`Batch ${item.itemCostId} tidak ditemukan`);

        // GOTCHA node-pg (Task 1): item_costs.stock sekarang NUMERIC, balik
        // string dari raw query — wajib Number() (beda dari waktu masih
        // INTEGER, auto-parse ke number).
        const systemQty = Number(row.stock);
        const delta = item.physicalQty - systemQty;

        if (delta === 0) {
          results.push({ refId: item.refId, itemCostId: item.itemCostId, name: row.name, systemQty, physicalQty: item.physicalQty, delta: 0 });
          continue;
        }

        await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = $1 WHERE id = $2`, item.physicalQty, item.itemCostId);

        // Mirror spareparts.stock ikut kekoreksi selisihnya — row udah
        // kekunci FOR UPDATE di atas (SEBELUM item_costs, lihat komentar lock
        // ordering di atas), aman dari race.
        if (item.kind === 'sparepart') {
          await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = stock + $1 WHERE id = $2`, delta, item.refId);
        }

        await tx.stockMovement.create({
          data: {
            itemKind: item.kind,
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
            detail: { kind: item.kind, itemCostId: item.itemCostId, name: row.name, systemQty, physicalQty: item.physicalQty, delta, note: dto.note ?? null },
          },
        });

        results.push({ refId: item.refId, itemCostId: item.itemCostId, name: row.name, systemQty, physicalQty: item.physicalQty, delta });
      }

      return results;
    });
  }

  /** BARU (Siklus QR per-unit, 2026-09-30) — daftar unit fisik (StockUnit)
   * 1 batch, dipakai cetak/cetak-ulang label QR (halaman
   * /stock/batches/:itemCostId/print-labels). */
  async findUnitsByBatch(itemCostId: string) {
    return this.prisma.stockUnit.findMany({
      where: { itemCostId },
      select: { id: true, unitCode: true, qrToken: true },
      orderBy: { createdAt: 'asc' },
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
