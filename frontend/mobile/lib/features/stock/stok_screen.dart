import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import 'stock_providers.dart';

const _reasonLabel = {
  'penjualan': 'Penjualan',
  'koreksi': 'Koreksi',
  'pembelian': 'Barang Masuk',
  'pemakaian': 'Pemakaian Job',
  'retur': 'Retur',
  'rusak': 'Rusak/Hilang',
};

class StokScreen extends ConsumerStatefulWidget {
  const StokScreen({super.key});

  @override
  ConsumerState<StokScreen> createState() => _StokScreenState();
}

class _StokScreenState extends ConsumerState<StokScreen> {
  int _tab = 0; // 0 = stok, 1 = mutasi

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(stockOverviewProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Stok & Mutasi'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(stockOverviewProvider),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                _Seg(label: 'Stok', selected: _tab == 0, onTap: () => setState(() => _tab = 0)),
                const SizedBox(width: 8),
                _Seg(label: 'Mutasi', selected: _tab == 1, onTap: () => setState(() => _tab = 1)),
              ],
            ),
          ),
          Expanded(
            child: async.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('Gagal memuat stok: $e',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.slate500)),
                ),
              ),
              data: (d) => _tab == 0 ? _stockList(d) : _movementList(d.movements),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stockList(StockOverview d) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        const _GroupLabel('Produk AC'),
        for (final s in d.products) _StockTile(row: s),
        if (d.products.isEmpty) const _Empty('Belum ada produk.'),
        const SizedBox(height: 16),
        const _GroupLabel('Sparepart / Material'),
        for (final s in d.spareparts) _StockTile(row: s),
        if (d.spareparts.isEmpty) const _Empty('Belum ada sparepart.'),
      ],
    );
  }

  Widget _movementList(List<MovementRow> moves) {
    if (moves.isEmpty) {
      return const _Empty('Belum ada mutasi stok.');
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      itemCount: moves.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, i) {
        final m = moves[i];
        final masuk = m.qtyChange >= 0;
        return Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Row(
            children: [
              Icon(masuk ? Icons.arrow_downward : Icons.arrow_upward,
                  size: 18, color: masuk ? AppColors.success : AppColors.danger),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(m.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            color: AppColors.slate900)),
                    Text(
                      '${_reasonLabel[m.reason] ?? m.reason}${m.at != null ? ' • ${_fmt(m.at!)}' : ''}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.slate500),
                    ),
                  ],
                ),
              ),
              Text(
                '${masuk ? '+' : ''}${_n(m.qtyChange)}',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: masuk ? AppColors.success : AppColors.danger),
              ),
            ],
          ),
        );
      },
    );
  }

  static String _n(num v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  static String _fmt(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}-${two(d.month)} ${two(d.hour)}:${two(d.minute)}';
  }
}

class _StockTile extends StatelessWidget {
  const _StockTile({required this.row});
  final StockRow row;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: row.low ? const Color(0xFFFDE68A) : AppColors.slate200),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(row.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontWeight: FontWeight.w600, color: AppColors.slate900)),
          ),
          if (row.low) ...[
            const Icon(Icons.warning_amber_rounded,
                size: 16, color: AppColors.warning),
            const SizedBox(width: 6),
          ],
          Text(
            'Stok ${_StokScreenState._n(row.stock)}',
            style: TextStyle(
                fontWeight: FontWeight.bold,
                color: row.low ? AppColors.warning : AppColors.slate700),
          ),
        ],
      ),
    );
  }
}

class _Seg extends StatelessWidget {
  const _Seg({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.teal600 : Colors.white,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
                color: selected ? AppColors.teal600 : AppColors.slate200),
          ),
          child: Text(label,
              style: TextStyle(
                  color: selected ? Colors.white : AppColors.slate600,
                  fontWeight: FontWeight.w600,
                  fontSize: 13)),
        ),
      ),
    );
  }
}

class _GroupLabel extends StatelessWidget {
  const _GroupLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 10),
      child: Text(text.toUpperCase(),
          style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
              color: AppColors.slate400)),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Center(
        child: Text(text, style: const TextStyle(color: AppColors.slate500)),
      ),
    );
  }
}
