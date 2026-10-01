import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import type { ListStatus } from '../common/dto/list-status-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
  ) {}

  /**
   * `sku` (kode pendek "PRD-0001", dst) digenerate otomatis di sini pakai
   * counter GLOBAL (bukan di-scope per-tanggal kayak barcode unit AC —
   * produk gak dibuat sesering itu, jadi nomor jalan terus aja tanpa reset
   * harian). Dibungkus $transaction biar counter & product.create()
   * atomic — kalau create gagal, nomor sku-nya ikut rollback, gak "bolong".
   */
  create(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertPairedProductValid(dto.pairedProductId);
      const seq = await this.counters.nextSeq(tx, 'product_sku');
      const sku = `PRD-${String(seq).padStart(4, '0')}`;
      // Paket AC Split (2026-09-30) — produk yang dipasangkan ke Outdoor
      // SELALU berperan Indoor, apapun `acRole` yang kekirim.
      const acRole = dto.pairedProductId ? 'indoor' : (dto.acRole ?? null);
      const product = await tx.product.create({ data: { ...dto, acRole, sku, active: true } });
      if (dto.pairedProductId) await this.markAsOutdoor(tx, dto.pairedProductId);
      return product;
    });
  }

  /** Paket AC Split (2026-09-30) — target `pairedProductId` SELALU
   * berperan Outdoor (lihat komentar `Product.acRole` di schema.prisma). */
  private async markAsOutdoor(tx: Prisma.TransactionClient, outdoorId: string) {
    await tx.product.update({ where: { id: outdoorId }, data: { acRole: 'outdoor' } });
  }

  /**
   * Validasi `pairedProductId` (Point 2, 2026-09-23) — kalau diisi, harus
   * nunjuk ke produk yang beneran ada dan bukan diri sendiri. `undefined`
   * (field gak dikirim sama sekali di PATCH) di-skip biar gak nge-block
   * update parsial yang gak nyentuh field ini.
   *
   * DIPERKUAT (audit 2026-09-29) — sebelumnya cuma 2 cek di atas, jadi
   * dua kasus ini lolos tanpa ketolak:
   *   1. Pairing muter-muter: A dipasangkan ke B, TERUS B juga dipasangkan
   *      ke A (atau ke siapapun) — relasi ini SENGAJA one-directional
   *      (cuma sisi Indoor yang isi field ini), jadi target yang mau
   *      dipasang gak boleh sendiri udah punya pairedProductId.
   *   2. 1 produk (jadi Outdoor) direbutin 2 Indoor sekaligus — target
   *      yang mau dipasang gak boleh udah jadi pasangan produk lain.
   *   3. Produk yang UDAH jadi Outdoor pasangan orang (dirinya sendiri
   *      target `pairedProductId` produk lain) gak boleh sekaligus disuruh
   *      masangkan diri ke produk lain juga (versi lain dari kasus 1,
   *      tapi dicek dari sisi `selfId` bukan sisi target) — kalau lolos,
   *      produk ini bakal keliatan "Indoor" (punya pairedProductId) DAN
   *      "Outdoor" (jadi target orang) sekaligus, bikin logic peran
   *      Indoor/Outdoor di ac-unit-pair.util.ts salah nebak pas dijual
   *      standalone.
   * Tanpa 3 cek ini, frontend (produk/page.tsx) yang nge-filter
   * "topLevelProducts" berdasarkan siapa aja yang jadi target
   * pairedProductId bakal nganggep produk yang salah pasang itu
   * sebagai "punya pasangan", dan bisa ilang dari tabel Master Data.
   */
  private async assertPairedProductValid(pairedProductId: string | undefined, selfId?: string) {
    if (pairedProductId === undefined) return;
    if (pairedProductId === selfId) {
      throw new BadRequestException('Produk gak bisa dipasangkan ke dirinya sendiri');
    }
    const pair = await this.prisma.product.findUnique({ where: { id: pairedProductId } });
    if (!pair) throw new BadRequestException(`Produk pasangan ${pairedProductId} tidak ditemukan`);

    if (pair.pairedProductId) {
      throw new BadRequestException(
        `Produk "${pair.name}" sudah berperan sebagai Outdoor pasangan produk lain, gak bisa dipasangkan lagi`,
      );
    }

    const alreadyClaimedBy = await this.prisma.product.findFirst({
      where: { pairedProductId, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { id: true, name: true },
    });
    if (alreadyClaimedBy) {
      throw new BadRequestException(
        `Produk ini sudah dipasangkan sebagai Outdoor buat "${alreadyClaimedBy.name}"`,
      );
    }

    if (selfId) {
      const selfClaimedAsOutdoorBy = await this.prisma.product.findFirst({
        where: { pairedProductId: selfId },
        select: { id: true, name: true },
      });
      if (selfClaimedAsOutdoorBy) {
        throw new BadRequestException(
          `Produk ini udah jadi Outdoor pasangan "${selfClaimedAsOutdoorBy.name}", gak bisa sekaligus dipasangkan ke produk lain`,
        );
      }
    }
  }

  /** BARU (Siklus QR per-unit, 2026-09-30) — stok Produk sekarang DIHITUNG
   * dari StockUnit (status='di_gudang' = tersedia), BUKAN lagi SUM angka
   * manual item_costs.stock (kolom itu udah dipensiunkan buat kind='product',
   * lihat StockService.stockIn & migration 20260930000000_qr_stock_units).
   * 'reserved' & 'keluar' SENGAJA gak keitung tersedia — 'reserved' udah
   * dikunci ke invoice tertentu (checkout), 'keluar' udah beneran pergi dari
   * gudang. Harga jual TETAP kolom langsung di Product (Siklus harga-seragam
   * 2026-09-22), gak berubah. */
  private async stockFor(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ ref_id: string; total_stock: string }[]>`
      SELECT ref_id, COUNT(*) AS total_stock
      FROM stock_units
      WHERE status = 'di_gudang' AND ref_id = ANY(${productIds})
      GROUP BY ref_id
    `;
    return new Map(rows.map((r) => [r.ref_id, Number(r.total_stock)]));
  }

  // BARU (2026-09-25, fitur nonaktifkan Master Data) — `status` opsional,
  // default 'active' biar konsumen lama (POS, dropdown pemilihan) gak
  // berubah perilakunya. 'all' gak nge-filter kolom active sama sekali.
  async findAll(status: ListStatus = 'active') {
    const where = status === 'all' ? {} : { active: status === 'inactive' ? false : true };
    const products = await this.prisma.product.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { pairedProduct: { select: { id: true, name: true } } },
    });
    const stockMap = await this.stockFor(products.map((p) => p.id));
    return products.map((p) => ({ ...p, stock: stockMap.get(p.id) ?? 0 }));
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      // `pairedWithMe` (Paket AC Split, 2026-09-30) — Indoor yang masangin
      // produk ini (kalau produk ini Outdoor sebuah paket), dipakai halaman
      // detail produk Outdoor buat nunjuk balik ke paketnya.
      include: {
        pairedProduct: { select: { id: true, name: true } },
        pairedWithMe: { select: { id: true, name: true } },
      },
    });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');
    const stockMap = await this.stockFor([id]);
    return { ...product, stock: stockMap.get(id) ?? 0 };
  }

  /** List batch aktif 1 produk — dipakai tabel "Batch Aktif" di halaman
   * detail produk. Urut TERTUA dulu (konsisten sama urutan FIFO di
   * StockLockingService.lockAndDeduct).
   *
   * Siklus QR per-unit (2026-09-30) — "aktif" DIHITUNG dari StockUnit
   * (status='di_gudang'), BUKAN item_costs.stock (kolom itu dipensiunkan
   * buat kind='product', SELALU 0 buat batch baru). INNER JOIN otomatis
   * nge-drop batch yang unitnya udah abis semua (reserved/keluar).
   *
   * BARU (Paket AC Split, 2026-09-30) — `includePair=true` ikut nyertain
   * batch produk PASANGANNYA (Indoor <-> Outdoor), tiap baris ditandai
   * `refId`/`unitName`/`unitRole` + `pairGroupId` (sama buat 2 batch dari
   * 1 barang masuk paket) biar halaman detail bisa nampilin stok per unit
   * dalam 1 kelompok. Default (false) = perilaku lama persis, cuma batch
   * produk ini sendiri (dipakai halaman /stock lama). */
  async findBatches(productId: string, includePair = false, includeBuyPrice = false) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');

    const refIds = [productId];
    if (includePair) {
      if (product.pairedProductId) {
        refIds.push(product.pairedProductId);
      } else {
        const indoor = await this.prisma.product.findFirst({
          where: { pairedProductId: productId },
          select: { id: true },
        });
        if (indoor) refIds.push(indoor.id);
      }
    }

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        ref_id: string;
        unit_name: string;
        ac_role: string | null;
        pair_group_id: string | null;
        supplier_name: string | null;
        buy_price: string;
        sell_price: string;
        created_at: Date;
        stock: string;
      }[]
    >`
      SELECT ic.id, ic.ref_id, p.name AS unit_name, p.ac_role, ic.pair_group_id,
             ic.supplier_name, ic.buy_price, ic.sell_price, ic.created_at,
             COUNT(su.id) AS stock
      FROM item_costs ic
      JOIN products p ON p.id = ic.ref_id
      JOIN stock_units su ON su.item_cost_id = ic.id AND su.status = 'di_gudang'
      WHERE ic.kind = 'product' AND ic.ref_id = ANY(${refIds})
      GROUP BY ic.id, p.name, p.ac_role
      ORDER BY ic.created_at ASC, p.ac_role ASC NULLS LAST
    `;

    return rows.map((r) => ({
      id: r.id,
      refId: r.ref_id,
      unitName: r.unit_name,
      unitRole: r.ac_role,
      pairGroupId: r.pair_group_id,
      supplierName: r.supplier_name,
      buyPrice: includeBuyPrice ? r.buy_price : null,
      sellPrice: r.sell_price,
      createdAt: r.created_at,
      stock: Number(r.stock),
    }));
  }

  /**
   * Edit produk setelah dibuat — gap yang ditemukan di audit migrasi (dulu
   * sama sekali gak ada endpoint update, harga salah ketik gak bisa
   * dibetulin). `stock`/`sellPrice` sengaja bukan bagian dari
   * UpdateProductDto, lihat komentar di sana.
   */
  async update(id: string, dto: UpdateProductDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Produk tidak ditemukan');
    await this.assertPairedProductValid(dto.pairedProductId, id);

    // Paket AC Split (2026-09-30) — peran produk yang lagi berpasangan
    // dikunci sama pairing-nya (Indoor = yang punya pairedProductId,
    // Outdoor = target-nya). `acRole` yang kekirim cuma boleh ngubah produk
    // yang GAK berpasangan.
    const willBeIndoorOfPair = !!(dto.pairedProductId ?? existing.pairedProductId);
    const isOutdoorOfPair =
      !willBeIndoorOfPair &&
      !!(await this.prisma.product.findFirst({ where: { pairedProductId: id }, select: { id: true } }));
    const lockedRole = willBeIndoorOfPair ? 'indoor' : isOutdoorOfPair ? 'outdoor' : undefined;
    if (lockedRole && dto.acRole !== undefined && dto.acRole !== lockedRole) {
      throw new BadRequestException(
        `Produk ini bagian dari paket AC, perannya tetap ${lockedRole === 'indoor' ? 'Indoor' : 'Outdoor'}`,
      );
    }
    const data = lockedRole ? { ...dto, acRole: lockedRole } : dto;

    const product = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data });
      if (dto.pairedProductId) await this.markAsOutdoor(tx, dto.pairedProductId);
      return updated;
    });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'product.update',
        target: id,
        // Cast — sama gotcha yang udah ketemu berkali-kali di service lain
        // (offline-sync, installation-packages): field2 UpdateProductDto
        // semuanya optional, jadi tipe hasil spread-nya termasuk `undefined`
        // per key, yang ditolak tipe Prisma buat kolom Json. Runtime-nya
        // aman (undefined otomatis ke-drop pas di-serialize ke JSON), ini
        // murni ngakalin type-checker.
        detail: { ...dto } as Prisma.InputJsonValue,
      },
    });

    return product;
  }
}
