import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_filter_chip.dart';
import 'stock_providers.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';

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
  StockLevel? _level; // filter tab Stok; null = semua

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(stockOverviewProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Stok & Mutasi'),
        actions: [
          IconButton(
            key: const Key('stok-opname'),
            icon: const Icon(Icons.fact_check_outlined),
            tooltip: 'Stock opname sparepart',
            onPressed: () => context.go('/stok/opname'),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(stockOverviewProvider),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('stok-adjust-fab'),
        onPressed: () => context.go('/stok/adjust'),
        icon: const Icon(Icons.add),
        label: const Text('Mutasi Stok'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                AppFilterChip(
                    label: 'Stok',
                    selected: _tab == 0,
                    onTap: () => setState(() => _tab = 0)),
                const SizedBox(width: 8),
                AppFilterChip(
                    label: 'Mutasi',
                    selected: _tab == 1,
                    onTap: () => setState(() => _tab = 1)),
              ],
            ),
          ),
          Expanded(
            child: async.when(
              loading: () => const AppSkeletonList(),
              error: (e, _) =>
                  AppErrorState(error: e, title: 'Gagal memuat stok'),
              data: (d) =>
                  _tab == 0 ? _stockList(d) : _movementList(d.movements),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stockList(StockOverview d) {
    final c = stockCounts([...d.products, ...d.spareparts]);
    bool keep(StockRow r) => _level == null || r.level == _level;
    final products = d.products.where(keep).toList();
    final spareparts = d.spareparts.where(keep).toList();
    final nothing = products.isEmpty && spareparts.isEmpty;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              AppFilterChip(
                label: 'Semua ${c.habis + c.menipis + c.aman}',
                selected: _level == null,
                onTap: () => setState(() => _level = null),
              ),
              const SizedBox(width: 8),
              AppFilterChip(
                label: 'Habis ${c.habis}',
                selected: _level == StockLevel.habis,
                onTap: () => setState(() => _level = StockLevel.habis),
              ),
              const SizedBox(width: 8),
              AppFilterChip(
                label: 'Menipis ${c.menipis}',
                selected: _level == StockLevel.menipis,
                onTap: () => setState(() => _level = StockLevel.menipis),
              ),
              const SizedBox(width: 8),
              AppFilterChip(
                label: 'Aman ${c.aman}',
                selected: _level == StockLevel.aman,
                onTap: () => setState(() => _level = StockLevel.aman),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (nothing)
          const _Empty('Tidak ada item pada filter ini.')
        else ...[
          if (products.isNotEmpty)
            _StockGroup(title: 'Produk AC', rows: products),
          if (products.isNotEmpty && spareparts.isNotEmpty)
            const SizedBox(height: 20),
          if (spareparts.isNotEmpty)
            _StockGroup(title: 'Sparepart / Material', rows: spareparts),
        ],
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
                  size: 18,
                  color: masuk ? AppColors.success : AppColors.danger),
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

/// Satu kartu per kelompok dengan pemisah tipis — jauh lebih tenang daripada
/// puluhan kartu bergaris sendiri-sendiri, dan baris yang perlu perhatian
/// langsung terbaca dari titik & angkanya.
class _StockGroup extends StatelessWidget {
  const _StockGroup({required this.title, required this.rows});
  final String title;
  final List<StockRow> rows;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Row(
            children: [
              Text(title,
                  style: const TextStyle(
                      fontFamily: AppFonts.display,
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.slate900)),
              const SizedBox(width: 8),
              Text('${rows.length}',
                  style:
                      const TextStyle(fontSize: 13, color: AppColors.slate400)),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            boxShadow: AppShadows.metric,
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var i = 0; i < rows.length; i++) ...[
                if (i > 0)
                  const Divider(
                      height: 1, indent: 40, color: AppColors.slate100),
                _StockRowTile(row: rows[i]),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _StockRowTile extends StatelessWidget {
  const _StockRowTile({required this.row});
  final StockRow row;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (row.level) {
      StockLevel.habis => (AppColors.danger, 'Habis'),
      StockLevel.menipis => (AppColors.warning, 'Menipis'),
      StockLevel.aman => (AppColors.success, 'Aman'),
    };
    return InkWell(
      key: Key('stock-row-${row.id}'),
      onTap: () => context.go('/stok/detail', extra: row),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        child: Row(
          children: [
            Semantics(
              label: label,
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(row.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontWeight: FontWeight.w500,
                      height: 1.3,
                      color: AppColors.slate900)),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  _StokScreenState._n(row.stock),
                  style: AppTextStyles.monoAmount.copyWith(
                    fontSize: 16,
                    height: 1.2,
                    color: row.level == StockLevel.aman
                        ? AppColors.slate900
                        : color,
                  ),
                ),
                if (row.min != null)
                  Text('min ${_StokScreenState._n(row.min!)}',
                      style: const TextStyle(
                          fontSize: 11, color: AppColors.slate400)),
              ],
            ),
          ],
        ),
      ),
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
