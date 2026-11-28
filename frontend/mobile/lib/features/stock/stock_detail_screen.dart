import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/utils/num_parse.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/router/app_router.dart' show currentUserProvider;
import '../../data/models/app_user.dart';
import '../master/master_providers.dart';
import '../master/widgets/fix_pending_dialog.dart';
import 'receive_providers.dart';
import 'receive_screen.dart' show ReceiveFields, ReceivedLabelButton;
import 'stock_providers.dart';
import '../../core/utils/error_message.dart';
import 'stock_label_pdf.dart';

// Detail stok satu barang (padanan halaman detail produk/sparepart di web, bagian stok): batch aktif beserta modal,
// dan untuk produk AC daftar unit fisik per QR. Untuk gudang halaman ini sekaligus tempat Barang Masuk,
// Koreksi stok, dan Betulkan (seperti web); peran lain hanya membaca.

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

/// Data terbaru satu barang. [receive] null = tidak diterima dari sini
/// (Outdoor paket, atau barang dinonaktifkan admin).
typedef StockDetail = ({Map<String, dynamic> info, ReceiveItem? receive});

StockDetail stockDetailFrom(StockItemKey k, List rows) {
  final product = k.kind == 'product';
  final info = rows.cast<Map>().firstWhere((r) => r['id'] == k.id, orElse: () => const {});
  final receive = receiveItemsFrom(
    products: product ? rows : const [],
    spareparts: product ? const [] : rows,
  ).where((i) => i.id == k.id).firstOrNull;
  return (info: Map<String, dynamic>.from(info), receive: receive);
}

final stockDetailProvider = FutureProvider.autoDispose.family<StockDetail, StockItemKey>((ref, k) async {
  final path = k.kind == 'product' ? '/products' : '/spareparts';
  return stockDetailFrom(k, await const ApiClient().get('$path?status=all') as List);
});

/// Stok seperti di web: "2 tabung + 5 kg = 25 kg"; produk AC (tanpa satuan) "3 unit".
String stockText(Map info) {
  final stock = numFromNest(info['stock']) ?? 0;
  final unit = '${info['unit'] ?? 'unit'}';
  final size = numFromNest(info['packSize']) ?? 0;
  final pack = '${info['packUnit'] ?? ''}';
  final plain = '${_n(stock)} $unit';
  if (!const ['konversi', 'gabungan'].contains(info['trackingMode']) || pack.isEmpty || size <= 0) {
    return plain;
  }
  final packs = (stock / size + 1e-6).floor();
  if (packs == 0) return plain;
  final rest = ((stock - packs * size) * 100).round() / 100;
  return rest == 0 ? '$packs $pack = $plain' : '$packs $pack + ${_n(rest)} $unit = $plain';
}

class StockDetailScreen extends ConsumerStatefulWidget {
  const StockDetailScreen({super.key, required this.row});
  final StockRow row;

  @override
  ConsumerState<StockDetailScreen> createState() => _StockDetailScreenState();
}

class _StockDetailScreenState extends ConsumerState<StockDetailScreen> {
  bool _perUnit = false;
  String _status = 'di_gudang';

  /// Hasil Barang Masuk terakhir; [_formRound] mengosongkan form sesudah simpan.
  Map<String, dynamic>? _received;
  int _formRound = 0;

  StockItemKey get _key => (kind: widget.row.kind, id: widget.row.id);

  void _refresh() {
    ref.invalidate(stockDetailProvider(_key));
    ref.invalidate(stockBatchesProvider(_key));
    ref.invalidate(stockUnitsProvider);
    ref.invalidate(stockOverviewProvider);
    ref.invalidate(widget.row.kind == 'product' ? productListProvider : sparepartListProvider);
  }

  Future<void> _correct() async {
    await context.push('/stok/opname', extra: widget.row.id);
    if (mounted) _refresh();
  }

  Future<void> _fix(Map<String, dynamic> info) async {
    final product = widget.row.kind == 'product';
    final saved = await showFixPendingDialog(
      context,
      path: '/${product ? 'products' : 'spareparts'}/${widget.row.id}',
      name: '${info['name'] ?? widget.row.name}',
      category: '${info['category'] ?? ''}',
      sku: product ? null : '${info['sku'] ?? ''}',
    );
    if (saved && mounted) _refresh();
  }

  Widget _warehouse() {
    final row = widget.row;
    final isProduct = row.kind == 'product';
    final detail = ref.watch(stockDetailProvider(_key));
    final info = detail.value?.info ?? const <String, dynamic>{};
    return Scaffold(
      appBar: AppBar(title: Text('${info['name'] ?? row.name}', overflow: TextOverflow.ellipsis)),
      body: detail.when(
        skipLoadingOnReload: true,
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(
          error: e,
          title: 'Gagal memuat barang',
          onRetry: () => ref.invalidate(stockDetailProvider(_key)),
        ),
        data: (d) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Text('Stok: ${stockText(d.info)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            if (d.info['pendingPrice'] == true)
              const Text('Menunggu harga', style: TextStyle(color: AppColors.slate600)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              OutlinedButton.icon(
                key: const Key('detail-fix-stock'),
                onPressed: _correct,
                icon: const Icon(Icons.fact_check_outlined, size: 18),
                label: const Text('Koreksi stok'),
              ),
              if (d.info['pendingPrice'] == true)
                OutlinedButton.icon(
                  key: const Key('detail-fix-item'),
                  onPressed: () => _fix(d.info),
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  label: const Text('Betulkan'),
                ),
            ]),
            const SizedBox(height: 20),
            ..._receiveSection(d),
            const SizedBox(height: 20),
            if (isProduct) ...[
              Row(children: _viewChips()),
              if (_perUnit) ...[const SizedBox(height: 8), _statusChips()],
            ] else
              Text(_listTitle(d.receive), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            if (isProduct && _perUnit)
              _units(row, embedded: true)
            else
              _batches(row, embedded: true, unit: isProduct ? null : '${d.info['unit'] ?? ''}'),
          ],
        ),
      ),
    );
  }

  String _listTitle(ReceiveItem? item) {
    if (item == null || !item.batchTracked) return 'Stok masuk';
    return 'Daftar ${item.packUnit.isEmpty ? 'gulungan' : item.packUnit}';
  }

  List<Widget> _receiveSection(StockDetail d) {
    final item = d.receive;
    if (item == null) {
      return [
        Text(d.info['acRole'] == 'outdoor'
            ? 'Barang masuk unit outdoor dicatat lewat produk Indoor pasangannya.'
            : 'Barang ini tidak bisa menerima barang masuk. Hubungi admin.'),
      ];
    }
    final hasLabels = _received?['batchId'] != null || _received?['outdoorBatchId'] != null;
    return [
      const Text('Barang Masuk', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      ReceiveFields(
        key: ValueKey(_formRound),
        item: item,
        onSaved: (res) {
          setState(() {
            _received = res;
            _formRound++;
          });
          ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Barang masuk tersimpan. Harga modal diisi admin.')));
          _refresh();
        },
      ),
      if (item.kind == 'product' && hasLabels) ...[
        const SizedBox(height: 8),
        ReceivedLabelButton(result: _received!, paired: item.outdoorId != null),
      ],
    ];
  }

  List<Widget> _viewChips() => [
        AppFilterChip(label: 'Per Batch', selected: !_perUnit, onTap: () => setState(() => _perUnit = false)),
        const SizedBox(width: 8),
        AppFilterChip(label: 'Per Unit', selected: _perUnit, onTap: () => setState(() => _perUnit = true)),
      ];

  Widget _statusChips() => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final e in [...unitStatusLabel.entries, const MapEntry('semua', 'Semua')]) ...[
            AppFilterChip(label: e.value, selected: _status == e.key, onTap: () => setState(() => _status = e.key)),
            const SizedBox(width: 8),
          ],
        ]),
      );

  @override
  Widget build(BuildContext context) {
    if (ref.watch(currentUserProvider).value?.role == UserRole.gudang) return _warehouse();
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
              if (!isProduct)
                OutlinedButton.icon(
                  key: const Key('detail-fix-stock'),
                  onPressed: () => context.go('/stok/opname', extra: row.id),
                  icon: const Icon(Icons.fact_check_outlined, size: 18),
                  label: const Text('Koreksi stok'),
                ),
              if (isProduct) ..._viewChips(),
            ]),
          ),
          if (isProduct)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  key: const Key('detail-fix-stock-product'),
                  onPressed: () => context.go('/stok/opname', extra: row.id),
                  icon: const Icon(Icons.fact_check_outlined, size: 18),
                  label: const Text('Koreksi stok'),
                ),
              ),
            ),
          if (isProduct && _perUnit)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
              child: _statusChips(),
            ),
          Expanded(child: isProduct && _perUnit ? _units(row) : _batches(row)),
        ],
      ),
    );
  }

  Future<void> _printBatch(StockBatch b, StockRow row) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await printBatchLabels(
          [(batchId: b.id, name: b.name.isEmpty ? row.name : b.name, role: b.role)]);
    } catch (e) {
      messenger.showSnackBar(
          SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    }
  }

  /// [unit] terisi (sparepart di halaman gudang): angkanya diberi satuan.
  Widget _batches(StockRow row, {bool embedded = false, String? unit}) {
    final async = ref.watch(stockBatchesProvider((kind: row.kind, id: row.id)));
    return async.when(
      loading: () => AppSkeletonList(shrinkWrap: embedded, count: embedded ? 2 : 6),
      error: (e, _) => AppErrorState(
        error: e,
        title: 'Gagal memuat batch',
        onRetry: () => ref.invalidate(stockBatchesProvider((kind: row.kind, id: row.id))),
      ),
      data: (list) {
        final active = list.where((b) => b.stock > 0).toList();
        if (active.isEmpty) {
          return AppEmptyState(
              compact: embedded,
              icon: Icons.inventory_2_outlined,
              title: 'Belum ada batch aktif',
              message: 'Barang ini belum punya stok.');
        }
        return ListView.separated(
          shrinkWrap: embedded,
          physics: embedded ? const NeverScrollableScrollPhysics() : null,
          padding: embedded ? const EdgeInsets.only(top: 8) : const EdgeInsets.fromLTRB(16, 8, 16, 24),
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
                            ? (unit == null ? 'Batch' : 'Masuk')
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
                  Text(unit == null ? _n(b.stock) : '${_n(b.stock)} $unit',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  if (row.kind == 'product')
                    IconButton(
                      key: Key('print-batch-${b.id}'),
                      icon: const Icon(Icons.print_outlined),
                      tooltip: 'Cetak label batch ini',
                      onPressed: () => _printBatch(b, row),
                    ),
                ]),
              ),
            );
          },
        );
      },
    );
  }

  Widget _units(StockRow row, {bool embedded = false}) {
    final key = (row.id, _status);
    final async = ref.watch(stockUnitsProvider(key));
    return async.when(
      loading: () => AppSkeletonList(shrinkWrap: embedded, count: embedded ? 2 : 6),
      error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat unit', onRetry: () => ref.invalidate(stockUnitsProvider(key))),
      data: (list) => list.isEmpty
          ? AppEmptyState(compact: embedded, icon: Icons.qr_code_2, title: 'Tidak ada unit')
          : ListView.separated(
              shrinkWrap: embedded,
              physics: embedded ? const NeverScrollableScrollPhysics() : null,
              padding: embedded ? const EdgeInsets.only(top: 8) : const EdgeInsets.fromLTRB(16, 8, 16, 24),
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
