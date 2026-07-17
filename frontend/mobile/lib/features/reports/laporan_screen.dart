import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/technician_job.dart';
import '../pos/cart_state.dart' show formatRupiah;
import 'reports_providers.dart';

const _methodLabel = {
  'tunai': 'Tunai',
  'transfer': 'Transfer',
  'qris': 'QRIS',
  'ewallet': 'E-wallet',
};

class LaporanScreen extends ConsumerWidget {
  const LaporanScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(analyticsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Laporan'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(analyticsProvider),
          ),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('Gagal memuat laporan: $e',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.slate500)),
          ),
        ),
        data: (a) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const _SectionLabel('Penjualan'),
            Row(
              children: [
                Expanded(
                  child: _Tile(
                    label: 'Hari Ini',
                    value: formatRupiah(a.salesToday),
                    sub: '${a.txToday} transaksi',
                    accent: AppColors.teal600,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _Tile(
                    label: '7 Hari',
                    value: formatRupiah(a.salesWeek),
                    accent: AppColors.blue600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _Tile(
              label: 'Bulan Ini',
              value: formatRupiah(a.salesMonth),
              sub: '${a.txMonth} transaksi',
              accent: AppColors.indigo600,
              wide: true,
            ),
            const SizedBox(height: 20),
            const _SectionLabel('Tren Penjualan (14 hari)'),
            _Card(child: _BarChart(a.dailySales)),
            const SizedBox(height: 20),
            const _SectionLabel('Produk Terlaris (bulan ini)'),
            _Card(
              child: Column(
                children: [
                  if (a.topProducts.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: Text('Belum ada penjualan bulan ini',
                          style: TextStyle(color: AppColors.slate400)),
                    )
                  else
                    for (final p in a.topProducts)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(p.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style:
                                      const TextStyle(color: AppColors.slate700)),
                            ),
                            Text('${_n(p.qty)}×',
                                style: const TextStyle(
                                    color: AppColors.slate400, fontSize: 13)),
                            const SizedBox(width: 12),
                            Text(formatRupiah(p.revenue),
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.slate900)),
                          ],
                        ),
                      ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            const _SectionLabel('Pembayaran (bulan ini)'),
            _Card(
              child: Column(
                children: [
                  for (final e in a.paymentsByMethod.entries)
                    _row(_methodLabel[e.key] ?? e.key, formatRupiah(e.value)),
                  const Divider(height: 18),
                  _row('Piutang (belum lunas)', formatRupiah(a.piutang),
                      danger: true),
                  _row('Invoice belum lunas', '${a.unpaidCount}'),
                ],
              ),
            ),
            const SizedBox(height: 20),
            const _SectionLabel('Stok'),
            _Card(
              child: Column(
                children: [
                  _row('Nilai persediaan', formatRupiah(a.inventoryValue)),
                  _row('Item menipis', '${a.lowStock.length}'),
                  if (a.lowStock.isNotEmpty) ...[
                    const Divider(height: 18),
                    for (final item in a.lowStock.take(8))
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            const Icon(Icons.warning_amber_rounded,
                                size: 16, color: AppColors.warning),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(item.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      color: AppColors.slate700)),
                            ),
                            Text('sisa ${_n(item.stock)}',
                                style: const TextStyle(
                                    color: AppColors.warning,
                                    fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 20),
            const _SectionLabel('Job Teknisi'),
            _Card(
              child: Column(
                children: [
                  for (final s in JobStatus.values)
                    _row(s.label, '${a.jobsByStatus[s] ?? 0}'),
                ],
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  static Widget _row(String label, String value, {bool danger = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.slate500)),
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: danger ? AppColors.danger : AppColors.slate900,
            ),
          ),
        ],
      ),
    );
  }

  static String _n(num v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();
}

class _Tile extends StatelessWidget {
  const _Tile({
    required this.label,
    required this.value,
    this.sub,
    required this.accent,
    this.wide = false,
  });

  final String label;
  final String value;
  final String? sub;
  final Color accent;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(width: 8, height: 8, decoration: BoxDecoration(
                  color: accent, shape: BoxShape.circle)),
              const SizedBox(width: 8),
              Text(label,
                  style: const TextStyle(
                      fontSize: 13, color: AppColors.slate500)),
            ],
          ),
          const SizedBox(height: 10),
          Text(value,
              style: TextStyle(
                  fontSize: wide ? 24 : 19,
                  fontWeight: FontWeight.bold,
                  color: AppColors.slate900)),
          if (sub != null) ...[
            const SizedBox(height: 2),
            Text(sub!,
                style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
          ],
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.slate200),
      ),
      child: child,
    );
  }
}

/// Bar chart tren harian, digambar dari widget biasa (tanpa dependency chart).
class _BarChart extends StatelessWidget {
  const _BarChart(this.data);
  final List<DaySales> data;

  @override
  Widget build(BuildContext context) {
    final maxVal = data.fold<int>(0, (m, d) => d.total > m ? d.total : m);
    final total = data.fold<int>(0, (s, d) => s + d.total);
    final first = data.isNotEmpty ? data.first.date : null;
    final last = data.isNotEmpty ? data.last.date : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(formatRupiah(total),
            style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: AppColors.slate900)),
        const Text('total 14 hari',
            style: TextStyle(fontSize: 12, color: AppColors.slate400)),
        const SizedBox(height: 12),
        SizedBox(
          height: 110,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (final d in data)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: Container(
                      height: maxVal == 0
                          ? 3
                          : (100 * d.total / maxVal).clamp(3, 100).toDouble(),
                      decoration: BoxDecoration(
                        color: d.total == maxVal && maxVal > 0
                            ? AppColors.teal600
                            : AppColors.teal600.withValues(alpha: 0.30),
                        borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(3)),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        if (first != null && last != null)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('${first.day}/${first.month}',
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.slate400)),
              const Text('Hari ini',
                  style: TextStyle(fontSize: 11, color: AppColors.slate400)),
            ],
          ),
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 10),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: AppColors.slate400,
        ),
      ),
    );
  }
}
