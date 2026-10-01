import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildStockReportRow, orderPairedRows, StockReportRow, StockReportCatalogItem } from './stock-report-row.util';

/**
 * Siklus 8 — semua endpoint di sini murni query AGREGAT dari data yang udah
 * dicatat Siklus 1 (dan Siklus 3 buat item_costs). Gak ada write/mutation di
 * sini sama sekali. Semua rentang tanggal pakai `invoices.created_at`
 * (bukan `transactions.created_at`) — satu sumber kebenaran, konsisten,
 * walau nilainya sama karena invoice selalu dibuat bareng transaksi di
 * PosService.checkout().
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async sales(start: Date, end: Date) {
    // 1) total & jumlah invoice dalam rentang
    const totals = await this.prisma.invoice.aggregate({
      where: { createdAt: { gte: start, lte: end } },
      _sum: {
        grandTotal: true,
        subtotal: true,
        discount: true,
        taxAmount: true,
      },
      _count: { _all: true },
    });

    // 2) breakdown per kategori produk — invoice_items.ref_id gak strict FK
    //    ke products (polymorphic, lihat VouchersService.isEligibleFirstPurchase
    //    buat pola serupa), jadi LEFT JOIN manual + fallback "Tanpa kategori"
    //    buat item yang produknya udah dihapus atau bukan kind='product'.
    const byCategory = await this.prisma.$queryRaw<
      { category: string; total_line: string; qty: string }[]
    >`
      SELECT COALESCE(p.category, 'Tanpa kategori') AS category,
             SUM(ii.line_total) AS total_line,
             SUM(ii.qty) AS qty
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN products p ON p.id = ii.ref_id
      WHERE ii.kind = 'product'
        AND i.created_at BETWEEN ${start} AND ${end}
      GROUP BY COALESCE(p.category, 'Tanpa kategori')
      ORDER BY total_line DESC
    `;

    // 3) grafik harian — DATE_TRUNC gak bisa lewat Prisma groupBy, wajib raw SQL.
    const daily = await this.prisma.$queryRaw<
      { date: Date; total: string; count: string }[]
    >`
      SELECT DATE_TRUNC('day', created_at)::date AS date,
             SUM(grand_total) AS total,
             COUNT(*) AS count
      FROM invoices
      WHERE created_at BETWEEN ${start} AND ${end}
      GROUP BY 1
      ORDER BY 1
    `;

    return {
      totalPenjualan: Number(totals._sum.grandTotal ?? 0),
      totalInvoice: totals._count._all,
      totalDiskon: Number(totals._sum.discount ?? 0),
      totalPajak: Number(totals._sum.taxAmount ?? 0),
      breakdownKategori: byCategory.map((r) => ({
        category: r.category,
        totalLine: Number(r.total_line),
        qty: Number(r.qty),
      })),
      grafikHarian: daily.map((r) => ({
        date: r.date,
        total: Number(r.total),
        count: Number(r.count),
      })),
    };
  }

  async service(start: Date, end: Date) {
    // 1) jumlah job per status (job yang DIBUAT dalam rentang tanggal)
    const byStatus = await this.prisma.technicianJob.groupBy({
      by: ['status'],
      where: { createdAt: { gte: start, lte: end } },
      _count: { _all: true },
    });

    // 2) rata-rata waktu pengerjaan (completed_at - started_at), cuma job
    //    yang beneran udah start & selesai di rentang ini.
    const avgRows = await this.prisma.$queryRaw<
      { avg_minutes: string | null }[]
    >`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) AS avg_minutes
      FROM technician_jobs
      WHERE completed_at IS NOT NULL AND started_at IS NOT NULL
        AND completed_at BETWEEN ${start} AND ${end}
    `;

    // 3) performa per teknisi — jumlah job selesai
    const byTechnician = await this.prisma.$queryRaw<
      { technician_id: string; display_name: string; completed_count: string }[]
    >`
      SELECT tj.technician_id, u.display_name, COUNT(*) AS completed_count
      FROM technician_jobs tj
      JOIN users u ON u.id = tj.technician_id
      WHERE tj.status = 'selesai'
        AND tj.completed_at BETWEEN ${start} AND ${end}
      GROUP BY tj.technician_id, u.display_name
      ORDER BY completed_count DESC
    `;

    return {
      jumlahPerStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count._all,
      })),
      rataRataWaktuPengerjaanMenit: avgRows[0]?.avg_minutes
        ? Math.round(Number(avgRows[0].avg_minutes))
        : null,
      performaTeknisi: byTechnician.map((t) => ({
        technicianId: t.technician_id,
        namaTeknisi: t.display_name,
        jobSelesai: Number(t.completed_count),
      })),
    };
  }

  /**
   * Siklus 8 (revisi) — `invoice_items.buy_price_snapshot` DIREKAM saat
   * checkout (lihat PosService.checkout) dan jadi sumber HPP UTAMA di sini.
   * `item_costs.buy_price` (harga beli TERKINI) cuma jadi FALLBACK buat
   * baris invoice_items LAMA (dibuat sebelum kolom snapshot ini ada), yang
   * nilainya pasti NULL. Hasilnya: laporan buat transaksi BARU akurat 100%
   * (harga beli yang beneran berlaku saat itu), transaksi LAMA tetap
   * seakurat sebelumnya (fallback ke harga terkini, sama kayak sebelum
   * revisi ini) — bukan mundur, cuma gak bisa "dipulihkan" mundur ke masa
   * lalu karena datanya emang gak pernah direkam.
   *
   * (Siklus batch-cost 2026-09: `item_costs.buy_price` fallback ini
   * sekarang RATA-RATA dari semua batch aktif per refId, bukan 1 nilai
   * tunggal — karena item_costs bisa punya banyak baris per produk.)
   */
  async profitLoss(start: Date, end: Date) {
    const lines = await this.prisma.$queryRaw<
      {
        kind: string;
        ref_id: string | null;
        name: string;
        qty_sold: string;
        revenue: string;
        cogs: string;
        baris_barang: string;
        baris_tanpa_snapshot: string;
        baris_tanpa_hpp_sama_sekali: string;
        baris_modal_tak_dialokasikan: string;
        modal_paket_maks: string;
      }[]
    >`
      SELECT ii.kind, ii.ref_id, ii.name,
             SUM(ii.qty) AS qty_sold,
             SUM(ii.line_total) AS revenue,
             SUM(ii.qty * COALESCE(ii.buy_price_snapshot, ic.buy_price, 0)) AS cogs,
             COUNT(*) FILTER (WHERE ii.kind != 'service') AS baris_barang,
             COUNT(*) FILTER (WHERE ii.kind != 'service' AND ii.buy_price_snapshot IS NULL) AS baris_tanpa_snapshot,
             COUNT(*) FILTER (WHERE ii.kind != 'service' AND ii.buy_price_snapshot IS NULL AND ic.buy_price IS NULL) AS baris_tanpa_hpp_sama_sekali,
             COUNT(*) FILTER (WHERE ii.cost_unallocated) AS baris_modal_tak_dialokasikan,
             COALESCE(SUM(ii.qty * ii.package_cost_ref) FILTER (WHERE ii.cost_unallocated), 0) AS modal_paket_maks
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN (
        -- Siklus batch-cost (2026-09): item_costs sekarang bisa banyak
        -- baris per (kind, ref_id) buat kind='product' (per-batch). Fallback
        -- HPP transaksi LAMA (buy_price_snapshot null) pakai RATA-RATA harga
        -- modal batch yang MASIH AKTIF (stock>0) buat refId itu — bukan join
        -- mentah (bakal gandain baris SUM di atas kalau langsung join
        -- item_costs tanpa di-agregat dulu di sini).
        -- "stock > 0" cuma relevan buat kind='product' (banyak batch, mau
        -- rata-rata yang MASIH ada barangnya). kind='sparepart' stock-nya
        -- SELALU 0 di item_costs (placeholder, gak dipakai — lihat
        -- StockService.stockIn) — kalau filter stock>0 dipaksa ke sparepart
        -- juga, baris sparepart-nya ketendang semua dan buy_price fallback-nya
        -- selalu NULL (ketemu review 2026-09-08, HPP sparepart lama jadi 0).
        SELECT kind, ref_id, AVG(buy_price) AS buy_price
        FROM item_costs
        WHERE kind != 'product' OR stock > 0
        GROUP BY kind, ref_id
      ) ic ON ic.kind = ii.kind AND ic.ref_id = ii.ref_id
      WHERE i.created_at BETWEEN ${start} AND ${end}
      GROUP BY ii.kind, ii.ref_id, ii.name
      ORDER BY revenue DESC
    `;

    const totalRevenue = lines.reduce((sum, l) => sum + Number(l.revenue), 0);
    const totalCogs = lines.reduce((sum, l) => sum + Number(l.cogs), 0);
    const grossProfit = totalRevenue - totalCogs;
    // Paket AC Split (audit 2026-09-30) — unit satuan dari paket HPP-nya 0,
    // jadi labaKotor di atas OPTIMIS (batas atas). Batas bawah = kalau tiap
    // unit satuan nanggung modal paket PENUH (kalau Indoor & Outdoor dari
    // paket yang sama dua-duanya dijual satuan, modal kehitung 2x -> makanya
    // ini "maks", bukan tebakan alokasi). Laba sebenernya di antara keduanya.
    const modalPaketMaks = lines.reduce((sum, l) => sum + Number(l.modal_paket_maks), 0);
    const barisSatuan = lines.reduce((sum, l) => sum + Number(l.baris_modal_tak_dialokasikan), 0);

    return {
      ringkasan: {
        totalPendapatan: totalRevenue,
        totalHpp: totalCogs, // HPP cuma dari kind 'product'/'sparepart'; 'service' selalu HPP 0
        labaKotor: grossProfit,
        barisJualSatuanTanpaModal: barisSatuan,
        modalPaketTakTeralokasiMaks: modalPaketMaks,
        labaKotorTerendah: grossProfit - modalPaketMaks,
        marginPersen:
          totalRevenue > 0
            ? Math.round((grossProfit / totalRevenue) * 10000) / 100
            : 0,
      },
      detailPerItem: lines.map((l) => {
        const qtySold = Number(l.qty_sold);
        const cogs = Number(l.cogs);
        const barisBarang = Number(l.baris_barang);
        const barisTanpaSnapshot = Number(l.baris_tanpa_snapshot);
        const barisTanpaHpp = Number(l.baris_tanpa_hpp_sama_sekali);
        const barisModalTakDialokasikan = Number(l.baris_modal_tak_dialokasikan);

        let catatan: string;
        if (l.kind === 'service') {
          catatan = 'Jasa servis — tidak ada HPP';
        } else if (barisModalTakDialokasikan > 0) {
          // Paket AC Split (2026-09-30) — unit satuan (Indoor saja /
          // Outdoor saja) dari produk AC berpasangan: modal restock dicatat
          // per paket & gak dipecah per unit, jadi HPP baris itu 0.
          catatan =
            barisModalTakDialokasikan === barisBarang
              ? 'Dijual satuan dari paket AC (Indoor/Outdoor saja) — modal tidak dialokasikan per unit, HPP dihitung 0'
              : `Sebagian transaksi (${barisModalTakDialokasikan} baris) dijual satuan dari paket AC — modal tidak dialokasikan, HPP dihitung 0 buat bagian itu`;
        } else if (barisTanpaHpp > 0) {
          catatan =
            barisTanpaHpp === barisBarang
              ? 'Belum ada data harga beli sama sekali (belum pernah diisi lewat Siklus 3 barang masuk) — HPP dihitung 0'
              : `Sebagian transaksi (${barisTanpaHpp} baris) belum ada data harga beli sama sekali — HPP dihitung 0 buat bagian itu`;
        } else if (barisTanpaSnapshot > 0) {
          // Fix dari audit: sebelumnya label ini SELALU bilang "transaksi
          // sebelum fitur snapshot ada" — padahal snapshot bisa null juga
          // buat transaksi BARU (pasca-migrasi) kalau item_costs-nya emang
          // belum diisi pas checkout (baru diisi belakangan). Dua penyebab
          // beda itu, tapi efeknya ke angka HPP SAMA (fallback ke harga
          // terkini) — makanya di sini gak coba nebak penyebabnya (butuh
          // bandingin createdAt invoice vs tanggal migration, informasi yang
          // gak ada di query ini), cukup jujur bilang APA yang kejadian ke
          // angkanya, bukan KENAPA.
          catatan =
            barisTanpaSnapshot === barisBarang
              ? 'HPP baris ini pakai harga beli TERKINI dari item_costs, bukan harga yang berlaku saat transaksi (transaksi lama sebelum fitur snapshot ada, atau item_costs belum keisi pas checkout)'
              : `Sebagian transaksi (${barisTanpaSnapshot} baris) pakai harga beli TERKINI (bukan snapshot saat transaksi), sisanya sudah akurat pakai snapshot`;
        } else {
          catatan =
            'HPP akurat — pakai harga beli yang berlaku saat transaksi (snapshot)';
        }

        return {
          kind: l.kind,
          refId: l.ref_id,
          name: l.name,
          qtyTerjual: qtySold,
          revenue: Number(l.revenue),
          buyPriceDipakai:
            l.kind === 'service' || qtySold === 0
              ? 0
              : Math.round(cogs / qtySold),
          hpp: cogs,
          catatan,
        };
      }),
    };
  }

  /**
   * Point 4 (2026-09-23) — Laporan Stok/Opname. Gabungan 2 query terpisah
   * (produk & sparepart, masing2 helper privat di bawah) — DIPISAH (bukan 1
   * query UNION raksasa) karena beda banget sumber "Sisa Stok"-nya (produk
   * SELALU dari item_costs agregat; sparepart tergantung `batchTracked`,
   * lihat komentar di `sparepartStockReport`). `filter.kind` nentuin query
   * mana yang jalan (kosong = jalanin dua2nya).
   */
  async stockMovements(
    start: Date,
    end: Date,
    filter: { kind?: string; refId?: string; category?: string },
  ): Promise<{
    items: StockReportRow[];
    ringkasan: { totalModalTersisa: number; totalOmzetTerjual: number; totalUntungTerjual: number };
  }> {
    const items: StockReportRow[] = [];

    if (!filter.kind || filter.kind === 'product') {
      items.push(...(await this.productStockReport(start, end, filter)));
    }
    if (!filter.kind || filter.kind === 'sparepart') {
      items.push(...(await this.sparepartStockReport(start, end, filter)));
    }

    const ringkasan = items.reduce(
      (acc, row) => ({
        totalModalTersisa: acc.totalModalTersisa + row.modalTersisa,
        totalOmzetTerjual: acc.totalOmzetTerjual + row.omzetTerjual,
        totalUntungTerjual: acc.totalUntungTerjual + row.untungTerjual,
      }),
      { totalModalTersisa: 0, totalOmzetTerjual: 0, totalUntungTerjual: 0 },
    );

    return { items, ringkasan };
  }

  /**
   * Satu baris per Product AKTIF. Produk sisi Indoor (`pairedProductId`
   * keisi, Point 2) dapet tambahan `unitGabungan` dari `buildStockReportRow`
   * — nama pasangan diambil dari query `pairInfoRows` yang GAK ikut kena
   * filter `refId`/`category` (biar tetep kebaca bener walau lagi difilter
   * kategori yang beda dari pasangannya).
   */
  private async productStockReport(
    start: Date,
    end: Date,
    filter: { refId?: string; category?: string },
  ): Promise<StockReportRow[]> {
    const catalog = await this.prisma.$queryRaw<
      { id: string; name: string; category: string | null; paired_product_id: string | null; ac_role: string | null }[]
    >`
      SELECT id, name, category, paired_product_id, ac_role
      FROM products
      WHERE active = true
        AND (${filter.refId ?? null}::text IS NULL OR id = ${filter.refId ?? null})
        AND (${filter.category ?? null}::text IS NULL OR category = ${filter.category ?? null})
      ORDER BY name ASC
    `;
    if (catalog.length === 0) return [];

    const pairInfoRows = await this.prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM products WHERE active = true
    `;
    const pairInfoMap = new Map(pairInfoRows.map((r) => [r.id, r.name]));

    const movementRows = await this.prisma.$queryRaw<
      { ref_id: string; opening: string | null; masuk: string | null; keluar: string | null }[]
    >`
      SELECT ref_id,
        SUM(qty_change) FILTER (WHERE created_at < ${start}) AS opening,
        SUM(qty_change) FILTER (WHERE created_at BETWEEN ${start} AND ${end} AND qty_change > 0) AS masuk,
        ABS(SUM(qty_change) FILTER (WHERE created_at BETWEEN ${start} AND ${end} AND qty_change < 0)) AS keluar
      FROM stock_movements
      WHERE item_kind = 'product' AND created_at <= ${end}
      GROUP BY ref_id
    `;
    const movementMap = new Map(movementRows.map((r) => [r.ref_id, r]));

    // Siklus QR per-unit (2026-09-30) — sisa & modal produk DIHITUNG dari
    // StockUnit (status='di_gudang'), BUKAN item_costs.stock (kolom itu
    // dipensiunkan buat kind='product', selalu 0 buat batch baru — fix bug
    // turunan yang sama kayak ProductsService.findBatches).
    const currentRows = await this.prisma.$queryRaw<{ ref_id: string; sisa: string; modal: string }[]>`
      SELECT su.ref_id, COUNT(*) AS sisa, SUM(ic.buy_price) AS modal
      FROM stock_units su
      JOIN item_costs ic ON ic.id = su.item_cost_id
      WHERE su.status = 'di_gudang'
      GROUP BY su.ref_id
    `;
    const currentMap = new Map(currentRows.map((r) => [r.ref_id, r]));

    const salesRows = await this.prisma.$queryRaw<
      { ref_id: string; omzet: string; cogs: string; qty_satuan: string | null }[]
    >`
      SELECT ii.ref_id,
        SUM(ii.line_total) AS omzet,
        SUM(ii.qty * COALESCE(ii.buy_price_snapshot, ic.buy_price, 0)) AS cogs,
        SUM(ii.qty) FILTER (WHERE ii.cost_unallocated) AS qty_satuan
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN (
        SELECT ic2.ref_id, AVG(ic2.buy_price) AS buy_price FROM item_costs ic2
        WHERE ic2.kind = 'product'
          AND EXISTS (SELECT 1 FROM stock_units su WHERE su.item_cost_id = ic2.id AND su.status = 'di_gudang')
        GROUP BY ic2.ref_id
      ) ic ON ic.ref_id = ii.ref_id
      WHERE ii.kind = 'product' AND i.created_at BETWEEN ${start} AND ${end}
      GROUP BY ii.ref_id
    `;
    const salesMap = new Map(salesRows.map((r) => [r.ref_id, r]));

    // Movement ber-pairGroupId dikunci di refId SISI INDOOR doang — lihat
    // komentar `StockMovement.pairGroupId` di schema.prisma (qty Outdoor di
    // aksi yang sama selalu sama, jangan dijumlah dobel).
    const unitRows = await this.prisma.$queryRaw<{ ref_id: string; masuk: string | null; keluar: string | null }[]>`
      SELECT ref_id,
        SUM(qty_change) FILTER (WHERE qty_change > 0) AS masuk,
        ABS(SUM(qty_change) FILTER (WHERE qty_change < 0)) AS keluar
      FROM stock_movements
      WHERE item_kind = 'product' AND pair_group_id IS NOT NULL
        AND created_at BETWEEN ${start} AND ${end}
      GROUP BY ref_id
    `;
    const unitMap = new Map(unitRows.map((r) => [r.ref_id, r]));

    const rows = catalog.map((c) => {
      const agg = movementMap.get(c.id);
      const cur = currentMap.get(c.id);
      const sales = salesMap.get(c.id);
      const item: StockReportCatalogItem = {
        itemKind: 'product',
        refId: c.id,
        name: c.name,
        unit: 'unit',
        category: c.category,
      };

      const opts = c.paired_product_id
        ? {
            pairedItem: {
              itemKind: 'product' as const,
              refId: c.paired_product_id,
              name: pairInfoMap.get(c.paired_product_id) ?? '(produk pasangan tidak aktif)',
              unit: 'unit',
              category: null,
            },
            pairedSisa: Number(currentMap.get(c.paired_product_id)?.sisa ?? 0),
            unitAgg: unitMap.get(c.id),
          }
        : undefined;

      const row = buildStockReportRow(
        item,
        {
          opening: agg?.opening,
          masuk: agg?.masuk,
          keluar: agg?.keluar,
          sisa: cur?.sisa,
          modal: cur?.modal,
          omzet: sales?.omzet,
          cogs: sales?.cogs,
        },
        opts,
      );
      // Paket AC Split (2026-09-30) — peran unit + jumlah yang dijual
      // satuan (modal gak dialokasikan), buat ditampilin di laporan.
      row.pairRole = c.ac_role === 'indoor' || c.ac_role === 'outdoor' ? c.ac_role : undefined;
      const qtySatuan = Number(sales?.qty_satuan ?? 0);
      if (qtySatuan > 0) row.jualSatuanTanpaModal = qtySatuan;
      return row;
    });

    // Laporan Stok (Paket AC Split, 2026-09-30) — baris Outdoor ditaruh
    // PERSIS di bawah baris Indoor pasangannya (tampil sekali, menjorok di
    // FE), bukan nyempil di urutan abjad di tempat lain.
    return orderPairedRows(
      rows,
      new Map(catalog.filter((c) => c.paired_product_id).map((c) => [c.id, c.paired_product_id!])),
    );
  }

  /**
   * Satu baris per Sparepart AKTIF. `batchTracked` nentuin sumber Sisa
   * Stok/Modal Tersisa (lihat komentar `Sparepart.batchTracked` &
   * `ItemCost.stock` di schema.prisma): batch-tracked pakai agregat
   * `item_costs` (stock>0) sama kayak produk; FLAT pakai `spareparts.stock`
   * (mirror resmi) dikali RATA-RATA `buy_price` SEMUA baris `item_costs`
   * sparepart itu (field `stock`-nya gak dipakai/selalu 0 buat flat, jadi
   * gak bisa difilter stock>0 — pola AVG ini SAMA kayak fallback HPP di
   * `ReportsService.profitLoss()`).
   */
  private async sparepartStockReport(
    start: Date,
    end: Date,
    filter: { refId?: string; category?: string },
  ): Promise<StockReportRow[]> {
    const catalog = await this.prisma.$queryRaw<
      { id: string; name: string; category: string | null; unit: string; stock: string; batch_tracked: boolean }[]
    >`
      SELECT id, name, category, unit, stock, batch_tracked
      FROM spareparts
      WHERE active = true
        AND (${filter.refId ?? null}::text IS NULL OR id = ${filter.refId ?? null})
        AND (${filter.category ?? null}::text IS NULL OR category = ${filter.category ?? null})
      ORDER BY name ASC
    `;
    if (catalog.length === 0) return [];

    const movementRows = await this.prisma.$queryRaw<
      { ref_id: string; opening: string | null; masuk: string | null; keluar: string | null }[]
    >`
      SELECT ref_id,
        SUM(qty_change) FILTER (WHERE created_at < ${start}) AS opening,
        SUM(qty_change) FILTER (WHERE created_at BETWEEN ${start} AND ${end} AND qty_change > 0) AS masuk,
        ABS(SUM(qty_change) FILTER (WHERE created_at BETWEEN ${start} AND ${end} AND qty_change < 0)) AS keluar
      FROM stock_movements
      WHERE item_kind = 'sparepart' AND created_at <= ${end}
      GROUP BY ref_id
    `;
    const movementMap = new Map(movementRows.map((r) => [r.ref_id, r]));

    const batchAggRows = await this.prisma.$queryRaw<{ ref_id: string; sisa: string; modal: string }[]>`
      SELECT ref_id, SUM(stock) AS sisa, SUM(stock * buy_price) AS modal
      FROM item_costs
      WHERE kind = 'sparepart' AND stock > 0
      GROUP BY ref_id
    `;
    const batchAggMap = new Map(batchAggRows.map((r) => [r.ref_id, r]));

    const avgPriceRows = await this.prisma.$queryRaw<{ ref_id: string; avg_price: string }[]>`
      SELECT ref_id, AVG(buy_price) AS avg_price
      FROM item_costs
      WHERE kind = 'sparepart'
      GROUP BY ref_id
    `;
    const avgPriceMap = new Map(avgPriceRows.map((r) => [r.ref_id, r]));

    const salesRows = await this.prisma.$queryRaw<{ ref_id: string; omzet: string; cogs: string }[]>`
      SELECT ii.ref_id,
        SUM(ii.line_total) AS omzet,
        SUM(ii.qty * COALESCE(ii.buy_price_snapshot, ic.buy_price, 0)) AS cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN (
        SELECT ref_id, AVG(buy_price) AS buy_price FROM item_costs
        WHERE kind = 'sparepart' GROUP BY ref_id
      ) ic ON ic.ref_id = ii.ref_id
      WHERE ii.kind = 'sparepart' AND i.created_at BETWEEN ${start} AND ${end}
      GROUP BY ii.ref_id
    `;
    const salesMap = new Map(salesRows.map((r) => [r.ref_id, r]));

    return catalog.map((c) => {
      const agg = movementMap.get(c.id);
      const sales = salesMap.get(c.id);
      const sisa = c.batch_tracked ? Number(batchAggMap.get(c.id)?.sisa ?? 0) : Number(c.stock);
      const modal = c.batch_tracked
        ? Number(batchAggMap.get(c.id)?.modal ?? 0)
        : Number(c.stock) * Number(avgPriceMap.get(c.id)?.avg_price ?? 0);

      return buildStockReportRow(
        { itemKind: 'sparepart', refId: c.id, name: c.name, unit: c.unit, category: c.category },
        {
          opening: agg?.opening,
          masuk: agg?.masuk,
          keluar: agg?.keluar,
          sisa,
          modal,
          omzet: sales?.omzet,
          cogs: sales?.cogs,
        },
      );
    });
  }
}
