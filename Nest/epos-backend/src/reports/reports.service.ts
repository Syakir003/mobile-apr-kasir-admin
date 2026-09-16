import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
      }[]
    >`
      SELECT ii.kind, ii.ref_id, ii.name,
             SUM(ii.qty) AS qty_sold,
             SUM(ii.line_total) AS revenue,
             SUM(ii.qty * COALESCE(ii.buy_price_snapshot, ic.buy_price, 0)) AS cogs,
             COUNT(*) FILTER (WHERE ii.kind != 'service') AS baris_barang,
             COUNT(*) FILTER (WHERE ii.kind != 'service' AND ii.buy_price_snapshot IS NULL) AS baris_tanpa_snapshot,
             COUNT(*) FILTER (WHERE ii.kind != 'service' AND ii.buy_price_snapshot IS NULL AND ic.buy_price IS NULL) AS baris_tanpa_hpp_sama_sekali
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

    return {
      ringkasan: {
        totalPendapatan: totalRevenue,
        totalHpp: totalCogs, // HPP cuma dari kind 'product'/'sparepart'; 'service' selalu HPP 0
        labaKotor: grossProfit,
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

        let catatan: string;
        if (l.kind === 'service') {
          catatan = 'Jasa servis — tidak ada HPP';
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
}
