import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/router/app_router.dart';
import '../../data/models/app_user.dart';
import '../../data/models/technician_job.dart';
import '../stock/stock_providers.dart';
import '../../core/utils/num_parse.dart';

/// Ringkasan angka operasional untuk Dashboard & Laporan — pengganti agregasi
/// client-side langsung dari Supabase pada migrasi Flutter -> Nest. Dirakit
/// dari endpoint yang SUDAH ADA dan sudah dipakai web (`GET /dashboard/summary`,
/// `GET /reports/sales`, `GET /reports/profit-loss`) — TIDAK ada endpoint baru
/// ditambah khusus buat ini.
///
/// Konsekuensinya, 3 metrik yang dulu dihitung langsung dari tabel finansial
/// mentah TIDAK TERSEDIA lagi (endpoint web memang tak menyediakannya) dan
/// sengaja DIHAPUS dari model ini, bukan cuma disembunyikan di UI:
/// `piutang` (nominal Rupiah tertunggak), `paymentsByMethod` (breakdown kas
/// per metode bayar), `inventoryValue` (nilai persediaan). Layar yang
/// menampilkannya disesuaikan (lihat `laporan_screen.dart`).
class Analytics {
  const Analytics({
    required this.salesToday,
    required this.salesWeek,
    required this.salesMonth,
    required this.txToday,
    required this.txMonth,
    required this.unpaidCount,
    required this.lowStock,
    required this.jobsByStatus,
    required this.dailySales,
    required this.topProducts,
  });

  final int salesToday;
  final int salesWeek;
  final int salesMonth;
  final int txToday;
  final int txMonth;
  final int unpaidCount;
  final List<LowStockItem> lowStock;

  /// Job AKTIF per status (`GET /dashboard/summary` tidak menyertakan
  /// 'selesai'/'dibatalkan' — itu snapshot "yang lagi jalan sekarang", bukan
  /// rekap historis semua status).
  final Map<JobStatus, int> jobsByStatus;

  /// Penjualan per hari (bruto, exclude batal/refund) untuk grafik tren.
  final List<DaySales> dailySales;

  /// Produk/jasa dengan omzet terbesar bulan ini — dari `detailPerItem`
  /// laporan laba-rugi (per item individual), BUKAN `breakdownKategori`
  /// laporan penjualan (itu per kategori, granularitas beda).
  final List<TopProduct> topProducts;
}

class LowStockItem {
  const LowStockItem({required this.name, required this.stock, required this.min});
  final String name;
  final num stock;
  final num min;
}

class DaySales {
  const DaySales({required this.date, required this.total, required this.count});

  /// Tanggal lokal (jam 00:00).
  final DateTime date;
  final int total;
  final int count;
}

class TopProduct {
  const TopProduct(
      {required this.name, required this.qty, required this.revenue});
  final String name;
  final num qty;
  final int revenue;
}

const _kChartDays = 14;

typedef DayBucket = ({int total, int count});

String dateOnly(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)}';
}

/// `grafikHarian` dari `GET /reports/sales` -> map tanggal (YYYY-MM-DD) ->
/// bucket. Fungsi murni — mudah dites.
Map<String, DayBucket> dailyBucketsFromNest(List<dynamic> grafikHarian) => {
      for (final d in grafikHarian)
        '${(d as Map)['date']}'.substring(0, 10): (
          total: (numFromNest(d['total']) ?? 0).toInt(),
          count: (numFromNest(d['count']) ?? 0).toInt(),
        ),
    };

/// Total bucket dari tanggal [since] (inklusif) sampai tanggal terbaru di
/// [buckets]. Fungsi murni — mudah dites.
int sumTotalSince(Map<String, DayBucket> buckets, DateTime since) {
  var total = 0;
  for (final e in buckets.entries) {
    final d = DateTime.tryParse(e.key);
    if (d != null && !d.isBefore(since)) total += e.value.total;
  }
  return total;
}

/// Sama seperti [sumTotalSince], tapi jumlah transaksi (`count`).
int sumCountSince(Map<String, DayBucket> buckets, DateTime since) {
  var total = 0;
  for (final e in buckets.entries) {
    final d = DateTime.tryParse(e.key);
    if (d != null && !d.isBefore(since)) total += e.value.count;
  }
  return total;
}

/// [days] ember berurutan berakhir pada [lastDay] (inklusif) — hari tanpa
/// bucket di [buckets] diisi nol. Fungsi murni — mudah dites.
List<DaySales> buildDailySales(
  Map<String, DayBucket> buckets,
  DateTime lastDay, {
  int days = _kChartDays,
}) {
  final start = DateTime(lastDay.year, lastDay.month, lastDay.day)
      .subtract(Duration(days: days - 1));
  return [
    for (var i = 0; i < days; i++)
      () {
        final date = start.add(Duration(days: i));
        final bucket = buckets[dateOnly(date)];
        return DaySales(
          date: date,
          total: bucket?.total ?? 0,
          count: bucket?.count ?? 0,
        );
      }(),
  ];
}

/// `invoiceBelumLunas` dari `GET /dashboard/summary` -> total baris di semua
/// status. Fungsi murni — mudah dites.
int unpaidCountFromNest(List<dynamic> invoiceBelumLunas) => invoiceBelumLunas
    .fold<int>(0, (a, b) => a + (((b as Map)['count'] as num?)?.toInt() ?? 0));

/// `jobAktifPerStatus` dari `GET /dashboard/summary`. Fungsi murni — mudah dites.
Map<JobStatus, int> jobsByStatusFromNest(List<dynamic> jobAktifPerStatus) => {
      for (final j in jobAktifPerStatus)
        JobStatus.fromValue((j as Map)['status']):
            (numFromNest(j['count'])?.toInt() ?? 0),
    };

/// `detailPerItem` dari `GET /reports/profit-loss`, urut omzet menurun.
/// Fungsi murni — mudah dites.
List<TopProduct> topProductsFromNest(List<dynamic> detailPerItem,
    {int limit = 5}) {
  final list = [
    for (final r in detailPerItem)
      TopProduct(
        name: '${(r as Map)['name']}',
        qty: numFromNest(r['qtyTerjual']) ?? 0,
        revenue: numFromNest(r['revenue'])?.toInt() ?? 0,
      ),
  ]..sort((a, b) => b.revenue.compareTo(a.revenue));
  return list.take(limit).toList();
}

/// [StockOverview] (sudah dari Nest, lihat `stockOverviewProvider`) -> item
/// yang stoknya di bawah/sama minimum. Fungsi murni — mudah dites.
List<LowStockItem> lowStockFromOverview(StockOverview stock) => [
      for (final p in stock.products)
        if (p.low) LowStockItem(name: p.name, stock: p.stock, min: p.min ?? 3),
      for (final s in stock.spareparts)
        if (s.low) LowStockItem(name: s.name, stock: s.stock, min: s.min ?? 0),
    ];

/// Satu provider untuk semua angka; di-refresh dengan invalidate.
///
/// `GET /reports/profit-loss` admin-only di Nest (beda dari
/// `/dashboard/summary` yang admin+kasir) — sengaja gak ikut dipanggil
/// kalau user login bukan admin, biar kasir (yang juga menampilkan dashboard
/// ini di mobile) gak kena 403 yang menggagalkan SELURUH `Future.wait`.
/// Efeknya cuma [Analytics.topProducts] kosong buat kasir — kartu dashboard
/// yang kasir lihat memang tidak menampilkannya (cuma dipakai
/// `laporan_screen.dart`, rute admin-only).
final analyticsProvider = FutureProvider.autoDispose<Analytics>((ref) async {
  const api = ApiClient();
  final isAdmin = ref.watch(currentUserProvider).value?.role == UserRole.admin;
  final now = DateTime.now();
  final startToday = DateTime(now.year, now.month, now.day);
  final startWeek = startToday.subtract(const Duration(days: 6));
  final startChart = startToday.subtract(const Duration(days: _kChartDays - 1));
  final startMonth = DateTime(now.year, now.month, 1);
  // Rentang `/reports/sales` cukup lebar buat nutupin chart 14-hari & bulan
  // berjalan sekaligus — grafikHarian per-hari-nya lalu dipakai ulang buat
  // menghitung salesToday/Week/Month tanpa query terpisah per rentang.
  final salesFrom =
      startMonth.isBefore(startChart) ? startMonth : startChart;

  final results = await Future.wait<dynamic>([
    api.get('/dashboard/summary'),
    api.get('/reports/sales?from=${dateOnly(salesFrom)}&to=${dateOnly(now)}'),
    isAdmin
        ? api.get('/reports/profit-loss?from=${dateOnly(startMonth)}&to=${dateOnly(now)}')
        : Future.value(const {'detailPerItem': <dynamic>[]}),
    ref.watch(stockOverviewProvider.future),
  ]);
  final summary = results[0] as Map;
  final sales = results[1] as Map;
  final profitLoss = results[2] as Map;
  final stock = results[3] as StockOverview;

  final daily = dailyBucketsFromNest((sales['grafikHarian'] as List?) ?? const []);
  final todayBucket = daily[dateOnly(startToday)];

  return Analytics(
    salesToday: todayBucket?.total ?? 0,
    salesWeek: sumTotalSince(daily, startWeek),
    salesMonth: sumTotalSince(daily, startMonth),
    txToday: todayBucket?.count ?? 0,
    txMonth: sumCountSince(daily, startMonth),
    unpaidCount: unpaidCountFromNest((summary['invoiceBelumLunas'] as List?) ?? const []),
    lowStock: lowStockFromOverview(stock),
    jobsByStatus: jobsByStatusFromNest((summary['jobAktifPerStatus'] as List?) ?? const []),
    dailySales: buildDailySales(daily, now),
    topProducts: topProductsFromNest((profitLoss['detailPerItem'] as List?) ?? const []),
  );
});
