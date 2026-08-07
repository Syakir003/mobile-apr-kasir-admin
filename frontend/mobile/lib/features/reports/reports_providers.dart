import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../data/models/invoice.dart';
import '../../data/models/technician_job.dart';

/// Ringkasan angka operasional untuk Dashboard & Laporan. Dihitung dari query
/// `select` (agregasi client-side) — tabel finansial read-only bagi client.
class Analytics {
  const Analytics({
    required this.salesToday,
    required this.salesWeek,
    required this.salesMonth,
    required this.txToday,
    required this.txMonth,
    required this.unpaidCount,
    required this.piutang,
    required this.paymentsByMethod,
    required this.lowStock,
    required this.inventoryValue,
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
  final int piutang;
  final Map<String, int> paymentsByMethod;
  final List<LowStockItem> lowStock;
  final int inventoryValue;
  final Map<JobStatus, int> jobsByStatus;

  /// Penjualan per hari (bruto, exclude batal/refund) untuk grafik tren.
  final List<DaySales> dailySales;

  /// Produk/jasa dengan omzet terbesar bulan ini.
  final List<TopProduct> topProducts;

  int get activeJobs =>
      jobsByStatus.entries
          .where((e) => e.key.isActive)
          .fold(0, (a, e) => a + e.value);
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

const _paymentMethods = ['tunai', 'transfer', 'qris', 'ewallet'];

const _kChartDays = 14;

bool _isVoid(dynamic status) {
  final s = InvoiceStatus.fromValue(status);
  return s == InvoiceStatus.batal || s == InvoiceStatus.refund;
}

/// Kelompokkan baris invoice ke [days] ember harian berurutan yang berakhir
/// pada [today]. Baris batal/refund diabaikan. Fungsi murni — mudah dites.
List<DaySales> bucketDailySales(
  List<Map<String, dynamic>> rows,
  DateTime today, {
  int days = _kChartDays,
}) {
  final start = DateTime(today.year, today.month, today.day)
      .subtract(Duration(days: days - 1));
  final totals = List<int>.filled(days, 0);
  final counts = List<int>.filled(days, 0);
  for (final r in rows) {
    if (_isVoid(r['status'])) continue;
    final created = DateTime.tryParse('${r['created_at']}')?.toLocal();
    if (created == null) continue;
    final day = DateTime(created.year, created.month, created.day);
    final idx = day.difference(start).inDays;
    if (idx < 0 || idx >= days) continue;
    totals[idx] += (r['grand_total'] as num?)?.toInt() ?? 0;
    counts[idx] += 1;
  }
  return [
    for (var i = 0; i < days; i++)
      DaySales(
          date: start.add(Duration(days: i)),
          total: totals[i],
          count: counts[i]),
  ];
}

/// Agregasi item invoice per nama, urut omzet (line_total) menurun, ambil
/// [limit] teratas. Item milik invoice batal/refund diabaikan
/// (`r['invoices']['status']`). Fungsi murni — mudah dites.
List<TopProduct> aggregateTopProducts(
  List<Map<String, dynamic>> itemRows, {
  int limit = 5,
}) {
  final qtyByName = <String, num>{};
  final revByName = <String, int>{};
  for (final r in itemRows) {
    final inv = r['invoices'];
    if (_isVoid(inv is Map ? inv['status'] : null)) continue;
    final name = '${r['name']}';
    qtyByName[name] = (qtyByName[name] ?? 0) + ((r['qty'] as num?) ?? 0);
    revByName[name] =
        (revByName[name] ?? 0) + ((r['line_total'] as num?)?.toInt() ?? 0);
  }
  final list = [
    for (final name in qtyByName.keys)
      TopProduct(name: name, qty: qtyByName[name]!, revenue: revByName[name]!),
  ];
  list.sort((a, b) => b.revenue.compareTo(a.revenue));
  return list.take(limit).toList();
}

/// Satu provider untuk semua angka; di-refresh dengan invalidate.
final analyticsProvider = FutureProvider.autoDispose<Analytics>((ref) async {
  final client = ref.watch(supabaseProvider);
  final now = DateTime.now();
  final startToday = DateTime(now.year, now.month, now.day);
  final startWeek = startToday.subtract(const Duration(days: 6));
  final startChart = startToday.subtract(const Duration(days: _kChartDays - 1));
  final startMonth = DateTime(now.year, now.month, 1);
  final from = [startMonth, startWeek, startChart]
      .reduce((a, b) => a.isBefore(b) ? a : b);

  // --- Invoices (penjualan, transaksi, piutang) ---
  final invRows = await client
      .from('invoices')
      .select('grand_total,total_paid,status,created_at')
      .gte('created_at', from.toUtc().toIso8601String())
      .limit(2000);
  final invList = (invRows as List).cast<Map<String, dynamic>>();

  var salesToday = 0, salesWeek = 0, salesMonth = 0;
  var txToday = 0, txMonth = 0, unpaidCount = 0, piutang = 0;
  for (final r in invList) {
    final status = InvoiceStatus.fromValue(r['status']);
    if (status == InvoiceStatus.batal || status == InvoiceStatus.refund) {
      continue;
    }
    final total = (r['grand_total'] as num?)?.toInt() ?? 0;
    final paid = (r['total_paid'] as num?)?.toInt() ?? 0;
    final created = DateTime.tryParse('${r['created_at']}')?.toLocal();
    if (created == null) continue;

    if (!created.isBefore(startMonth)) {
      salesMonth += total;
      txMonth += 1;
    }
    if (!created.isBefore(startWeek)) salesWeek += total;
    if (!created.isBefore(startToday)) {
      salesToday += total;
      txToday += 1;
    }
    if (status == InvoiceStatus.belumDibayar ||
        status == InvoiceStatus.dp ||
        status == InvoiceStatus.kurangBayar) {
      unpaidCount += 1;
      piutang += (total - paid).clamp(0, total);
    }
  }

  // --- Pembayaran per metode (bulan ini) ---
  final payRows = await client
      .from('manual_payments')
      .select('method,amount,created_at')
      .gte('created_at', startMonth.toUtc().toIso8601String())
      .limit(5000);
  final paymentsByMethod = {for (final m in _paymentMethods) m: 0};
  for (final r in (payRows as List)) {
    final m = '${r['method']}';
    final amt = (r['amount'] as num?)?.toInt() ?? 0;
    if (paymentsByMethod.containsKey(m)) paymentsByMethod[m] = paymentsByMethod[m]! + amt;
  }

  // --- Stok: nilai persediaan + item menipis ---
  // Harga modal tidak lagi menempel pada baris barang: sejak migrasi 0021 ia
  // tinggal di `item_costs` yang hanya terbaca admin. Laporan memang layar
  // admin, jadi cukup ambil tabel itu sekali lalu dipetakan per id.
  final products = await client
      .from('products')
      .select('id,name,stock,active')
      .eq('active', true);
  final spareparts = await client
      .from('spareparts')
      .select('id,name,stock,min_stock,active')
      .eq('active', true);
  final costRows = await client.from('item_costs').select('kind,ref_id,buy_price');
  final costs = <String, int>{
    for (final r in (costRows as List))
      '${(r as Map)['kind']}:${r['ref_id']}':
          ((r['buy_price'] as num?) ?? 0).toInt(),
  };

  var inventoryValue = 0;
  final lowStock = <LowStockItem>[];
  for (final r in (products as List)) {
    final stock = (r['stock'] as num?) ?? 0;
    inventoryValue += (stock * (costs['product:${r['id']}'] ?? 0)).toInt();
    if (stock <= 3) {
      lowStock.add(LowStockItem(name: '${r['name']}', stock: stock, min: 3));
    }
  }
  for (final r in (spareparts as List)) {
    final stock = (r['stock'] as num?) ?? 0;
    final min = (r['min_stock'] as num?) ?? 0;
    inventoryValue += (stock * (costs['sparepart:${r['id']}'] ?? 0)).toInt();
    if (stock <= min) {
      lowStock.add(LowStockItem(name: '${r['name']}', stock: stock, min: min));
    }
  }

  // --- Produk terlaris (bulan ini) — join invoice_items → invoices ---
  final itemRows = await client
      .from('invoice_items')
      .select('name,qty,line_total,invoices!inner(status,created_at)')
      .gte('invoices.created_at', startMonth.toUtc().toIso8601String())
      .limit(5000);
  final topProducts =
      aggregateTopProducts((itemRows as List).cast<Map<String, dynamic>>());

  // --- Job per status ---
  final jobRows =
      await client.from('technician_jobs').select('status').limit(5000);
  final jobsByStatus = <JobStatus, int>{};
  for (final r in (jobRows as List)) {
    final s = JobStatus.fromValue(r['status']);
    jobsByStatus[s] = (jobsByStatus[s] ?? 0) + 1;
  }

  return Analytics(
    salesToday: salesToday,
    salesWeek: salesWeek,
    salesMonth: salesMonth,
    txToday: txToday,
    txMonth: txMonth,
    unpaidCount: unpaidCount,
    piutang: piutang,
    paymentsByMethod: paymentsByMethod,
    lowStock: lowStock,
    inventoryValue: inventoryValue,
    jobsByStatus: jobsByStatus,
    dailySales: bucketDailySales(invList, now),
    topProducts: topProducts,
  );
});
