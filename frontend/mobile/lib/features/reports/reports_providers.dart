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

const _paymentMethods = ['tunai', 'transfer', 'qris', 'ewallet'];

/// Satu provider untuk semua angka; di-refresh dengan invalidate.
final analyticsProvider = FutureProvider.autoDispose<Analytics>((ref) async {
  final client = ref.watch(supabaseProvider);
  final now = DateTime.now();
  final startToday = DateTime(now.year, now.month, now.day);
  final startWeek = startToday.subtract(const Duration(days: 6));
  final startMonth = DateTime(now.year, now.month, 1);
  final from = startMonth.isBefore(startWeek) ? startMonth : startWeek;

  // --- Invoices (penjualan, transaksi, piutang) ---
  final invRows = await client
      .from('invoices')
      .select('grand_total,total_paid,status,created_at')
      .gte('created_at', from.toUtc().toIso8601String())
      .limit(2000);

  var salesToday = 0, salesWeek = 0, salesMonth = 0;
  var txToday = 0, txMonth = 0, unpaidCount = 0, piutang = 0;
  for (final r in (invRows as List)) {
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
  final products = await client
      .from('products')
      .select('name,stock,buy_price,active')
      .eq('active', true);
  final spareparts = await client
      .from('spareparts')
      .select('name,stock,min_stock,buy_price,active')
      .eq('active', true);

  var inventoryValue = 0;
  final lowStock = <LowStockItem>[];
  for (final r in (products as List)) {
    final stock = (r['stock'] as num?) ?? 0;
    inventoryValue += (stock * ((r['buy_price'] as num?) ?? 0)).toInt();
    if (stock <= 3) {
      lowStock.add(LowStockItem(name: '${r['name']}', stock: stock, min: 3));
    }
  }
  for (final r in (spareparts as List)) {
    final stock = (r['stock'] as num?) ?? 0;
    final min = (r['min_stock'] as num?) ?? 0;
    inventoryValue += (stock * ((r['buy_price'] as num?) ?? 0)).toInt();
    if (stock <= min) {
      lowStock.add(LowStockItem(name: '${r['name']}', stock: stock, min: min));
    }
  }

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
  );
});
