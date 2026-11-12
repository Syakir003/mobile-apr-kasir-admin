import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/utils/num_parse.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import 'stock_providers.dart';

// Detail stok satu barang (padanan halaman detail produk/sparepart di web, bagian stok): batch aktif beserta modal,
// dan untuk produk AC daftar unit fisik per QR. Hanya baca; barang masuk/opname lewat layar Mutasi/Opname.

/// Satu batch (ItemCost). [buyPrice] null bila peran tidak boleh melihat modal.
class StockBatch {
  StockBatch(Map<String, dynamic> j)
      : id = '${j['id']}',
        name = (j['unitName'] as String?) ?? '',
        role = j['unitRole'] as String?,
        supplier = j['supplierName'] as String?,
        buyPrice = j['buyPrice'] == null ? null : numFromNest(j['buyPrice']),
        stock = numFromNest(j['stock']) ?? 0,
        createdAt = DateTime.tryParse('${j['createdAt']}')?.toLocal();
  final String id;
  final String name;
  final String? role; // indoor | outdoor | null
  final String? supplier;
  final num? buyPrice;
  final num stock;
  final DateTime? createdAt;
}

/// Satu unit fisik ber-QR (GET /products/:id/units).
class StockUnit {
  StockUnit(Map<String, dynamic> j)
      : code = '${j['unitCode']}',
        status = '${j['status']}',
        name = (j['unitName'] as String?) ?? '',
        role = j['unitRole'] as String?,
        supplier = j['supplierName'] as String?,
        receivedAt = DateTime.tryParse('${j['receivedAt']}')?.toLocal();
  final String code;
  final String status;
  final String name;
  final String? role;
  final String? supplier;
  final DateTime? receivedAt;
}

const unitStatusLabel = {'di_gudang': 'Di gudang', 'reserved': 'Dipesan invoice', 'keluar': 'Sudah keluar'};

String _n(num v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();
String _date(DateTime? d) {
  if (d == null) return '-';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year}';
}

typedef StockItemKey = ({String kind, String id});

final stockBatchesProvider = FutureProvider.autoDispose.family<List<StockBatch>, StockItemKey>((ref, k) async {
  final path = k.kind == 'product' ? '/products/${k.id}/batches?includePair=1' : '/spareparts/${k.id}/batches';
  final rows = await const ApiClient().get(path) as List;
  return [for (final r in rows) StockBatch(Map<String, dynamic>.from(r as Map))];
});

/// Unit fisik per QR; [status] 'di_gudang' | 'reserved' | 'keluar' | 'semua'.
final stockUnitsProvider = FutureProvider.autoDispose.family<List<StockUnit>, (String, String)>((ref, k) async {
  final (id, status) = k;
  final rows = await const ApiClient().get('/products/$id/units?includePair=1&status=$status') as List;
  return [for (final r in rows) StockUnit(Map<String, dynamic>.from(r as Map))];
});

class StockDetailScreen extends ConsumerStatefulWidget {
  const StockDetailScreen({super.key, required this.row});
  final StockRow row;

  @override
  ConsumerState<StockDetailScreen> createState() => _StockDetailScreenState();
}

class _StockDetailScreenState extends ConsumerState<StockDetailScreen> {
  bool _perUnit = false;
  String _status = 'di_gudang';

  @override
  Widget build(BuildContext context) {
    final row = widget.row;
    final isProduct = row.kind == 'product';
    return Scaffold(
      appBar: AppBar(title: Text(row.name, overflow: TextOverflow.ellipsis)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(children: [
              Expanded(
                child: Text('Stok ${_n(row.stock)}',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              ),
              if (isProduct) ...[
                AppFilterChip(label: 'Per Batch', selected: !_perUnit, onTap: () => setState(() => _perUnit = false)),
                const SizedBox(width: 8),
                AppFilterChip(label: 'Per Unit', selected: _perUnit, onTap: () => setState(() => _perUnit = true)),
              ],
            ]),
          ),
          if (isProduct && _perUnit)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(children: [
                  for (final e in [...unitStatusLabel.entries, const MapEntry('semua', 'Semua')]) ...[
                    AppFilterChip(label: e.value, selected: _status == e.key, onTap: () => setState(() => _status = e.key)),
                    const SizedBox(width: 8),
                  ],
                ]),
              ),
            ),
          Expanded(child: isProduct && _perUnit ? _units(row) : _batches(row)),
        ],
      ),
    );
  }

  Widget _batches(StockRow row) {
    final async = ref.watch(stockBatchesProvider((kind: row.kind, id: row.id)));
    return async.when(
      loading: () => const AppSkeletonList(),
      error: (e, _) => AppErrorState(
        error: e,
        title: 'Gagal memuat batch',
        onRetry: () => ref.invalidate(stockBatchesProvider((kind: row.kind, id: row.id))),
      ),
      data: (list) {
        final active = list.where((b) => b.stock > 0).toList();
        if (active.isEmpty) {
          return const AppEmptyState(
              icon: Icons.inventory_2_outlined, title: 'Belum ada batch aktif', message: 'Barang ini belum punya stok.');
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          itemCount: active.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (_, i) {
            final b = active[i];
            return Card(
              key: Key('batch-${b.id}'),
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(
                        [if (b.name.isNotEmpty) b.name, if (b.role != null) b.role!].join(' · ').isEmpty
                            ? 'Batch'
                            : [if (b.name.isNotEmpty) b.name, if (b.role != null) b.role!].join(' · '),
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      Text(
                        [_date(b.createdAt), if ((b.supplier ?? '').isNotEmpty) b.supplier!].join(' · '),
                        style: const TextStyle(fontSize: 12, color: AppColors.slate600),
                      ),
                      if (b.buyPrice != null)
                        Text('Modal ${formatRupiahNum(b.buyPrice!)}',
                            style: const TextStyle(fontSize: 12, color: AppColors.slate600)),
                    ]),
                  ),
                  Text(_n(b.stock), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                ]),
              ),
            );
          },
        );
      },
    );
  }

  Widget _units(StockRow row) {
    final key = (row.id, _status);
    final async = ref.watch(stockUnitsProvider(key));
    return async.when(
      loading: () => const AppSkeletonList(),
      error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat unit', onRetry: () => ref.invalidate(stockUnitsProvider(key))),
      data: (list) => list.isEmpty
          ? const AppEmptyState(icon: Icons.qr_code_2, title: 'Tidak ada unit')
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              itemCount: list.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final u = list[i];
                return ListTile(
                  key: Key('unit-${u.code}'),
                  dense: true,
                  title: Text(u.code, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w600)),
                  subtitle: Text([
                    if (u.role != null) u.role!,
                    if ((u.supplier ?? '').isNotEmpty) u.supplier!,
                    'masuk ${_date(u.receivedAt)}',
                  ].join(' · ')),
                  trailing: Text(unitStatusLabel[u.status] ?? u.status, style: const TextStyle(fontSize: 12)),
                );
              },
            ),
    );
  }
}
