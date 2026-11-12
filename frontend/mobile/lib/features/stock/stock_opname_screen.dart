import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/num_parse.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import 'stock_providers.dart';

// Stock opname sparepart (padanan tab Opname di web): hitung fisik, lalu samakan angka sistem. Produk AC tidak
// diopname lewat angka (stoknya dari unit QR), jadi backend menolaknya. Sparepart per gulungan dioopname per gulungan.

/// Satu gulungan/batch sparepart (GET /spareparts/:id/batches).
class SparepartBatch {
  const SparepartBatch({required this.id, required this.stock, this.supplier, this.createdAt});
  final String id;
  final num stock;
  final String? supplier;
  final DateTime? createdAt;

  String get label {
    final d = createdAt?.toLocal();
    final tgl = d == null ? '' : '${d.day.toString().padLeft(2, '0')}-${d.month.toString().padLeft(2, '0')}-${d.year}';
    return [if (supplier != null && supplier!.isNotEmpty) supplier!, if (tgl.isNotEmpty) tgl, 'sisa ${_n(stock)}']
        .join(' · ');
  }
}

String _n(num v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

final sparepartBatchesProvider = FutureProvider.autoDispose.family<List<SparepartBatch>, String>((ref, id) async {
  final rows = await const ApiClient().get('/spareparts/$id/batches') as List;
  return [
    for (final r in rows)
      SparepartBatch(
        id: '${(r as Map)['id']}',
        stock: numFromNest(r['stock']) ?? 0,
        supplier: r['supplierName'] as String?,
        createdAt: DateTime.tryParse('${r['createdAt']}'),
      ),
  ];
});

/// Muatan `POST /stock/opname` untuk satu sparepart ([batchId] diisi bila sparepart per gulungan).
Map<String, dynamic> buildOpnamePayload({
  required String refId,
  String? batchId,
  required num physicalQty,
  String note = '',
}) =>
    {
      'items': [
        {
          'kind': 'sparepart',
          'refId': refId,
          if (batchId != null) 'itemCostId': batchId,
          'physicalQty': physicalQty,
        },
      ],
      if (note.trim().isNotEmpty) 'note': note.trim(),
    };

/// Teks hasil: selisih sistem vs fisik. [result] = satu entri respons ({delta, systemQty, physicalQty}).
String opnameResultText(Map result) {
  final delta = numFromNest(result['delta']) ?? 0;
  if (delta == 0) return 'Stok sudah sesuai, tidak ada perubahan.';
  return 'Stok dikoreksi ${delta > 0 ? '+' : ''}${_n(delta)} '
      '(sistem ${_n(numFromNest(result['systemQty']) ?? 0)}, fisik ${_n(numFromNest(result['physicalQty']) ?? 0)}).';
}

final stockOpnameCallerProvider = Provider<Future<String> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final r = await const ApiClient().post('/stock/opname', body: payload);
    ref.invalidate(stockOverviewProvider);
    final first = r is List && r.isNotEmpty ? r.first : null;
    return first is Map ? opnameResultText(first) : 'Opname tersimpan.';
  };
});

class StockOpnameScreen extends ConsumerStatefulWidget {
  const StockOpnameScreen({super.key});

  @override
  ConsumerState<StockOpnameScreen> createState() => _StockOpnameScreenState();
}

class _StockOpnameScreenState extends ConsumerState<StockOpnameScreen> {
  String? _itemId;
  String? _batchId;
  final _physical = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _physical.dispose();
    _note.dispose();
    super.dispose();
  }

  num? get _physicalValue => num.tryParse(_physical.text.trim().replaceAll(',', '.'));

  Future<void> _submit() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final text = await ref.read(stockOpnameCallerProvider)(buildOpnamePayload(
        refId: _itemId!,
        batchId: _batchId,
        physicalQty: _physicalValue!,
        note: _note.text,
      ));
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(text)));
      _physical.clear();
      _note.clear();
      if (_itemId != null) ref.invalidate(sparepartBatchesProvider(_itemId!));
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(stockOverviewProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Stock Opname')),
      body: async.when(
        loading: () => const AppSkeletonDetail(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat sparepart'),
        data: (d) {
          final item = d.spareparts.where((s) => s.id == _itemId).cast<StockRow?>().firstOrNull;
          final batches = item != null && item.batchTracked ? ref.watch(sparepartBatchesProvider(item.id)) : null;
          final batch = batches?.asData?.value.where((b) => b.id == _batchId).firstOrNull;
          final system = item == null ? null : (item.batchTracked ? batch?.stock : item.stock);
          final physical = _physicalValue;
          final needsBatch = item != null && item.batchTracked;
          final valid = item != null && physical != null && physical >= 0 && (!needsBatch || batch != null) && !_busy;

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              const Text(
                'Hitung stok fisik lalu samakan angka sistem. Stok produk AC tidak diopname lewat angka: stoknya '
                'dihitung dari unit QR.',
                style: TextStyle(fontSize: 12, color: AppColors.slate600),
              ),
              const SizedBox(height: 16),
              const Text('Sparepart', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                key: const Key('opname-item'),
                initialValue: d.spareparts.any((s) => s.id == _itemId) ? _itemId : null,
                isExpanded: true,
                decoration: const InputDecoration(hintText: 'Pilih sparepart'),
                items: [
                  for (final s in d.spareparts)
                    DropdownMenuItem(
                      value: s.id,
                      child: Text('${s.name}${s.batchTracked ? ' (per gulungan)' : ' · stok ${_n(s.stock)}'}',
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: _busy
                    ? null
                    : (v) => setState(() {
                          _itemId = v;
                          _batchId = null;
                        }),
              ),
              if (d.spareparts.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: AppEmptyState(icon: Icons.build_outlined, title: 'Belum ada sparepart', compact: true),
                ),
              if (needsBatch) ...[
                const SizedBox(height: 16),
                const Text('Gulungan', style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                batches!.when(
                  loading: () => const LinearProgressIndicator(),
                  error: (e, _) => Text('Gagal memuat gulungan: ${errorMessage(e)}',
                      style: const TextStyle(color: AppColors.danger)),
                  data: (list) => list.isEmpty
                      ? const Text('Belum ada gulungan.', style: TextStyle(color: AppColors.slate600))
                      : DropdownButtonFormField<String>(
                          key: const Key('opname-batch'),
                          initialValue: list.any((b) => b.id == _batchId) ? _batchId : null,
                          isExpanded: true,
                          decoration: const InputDecoration(hintText: 'Pilih gulungan'),
                          items: [
                            for (final b in list)
                              DropdownMenuItem(value: b.id, child: Text(b.label, overflow: TextOverflow.ellipsis)),
                          ],
                          onChanged: _busy ? null : (v) => setState(() => _batchId = v),
                        ),
                ),
              ],
              const SizedBox(height: 16),
              const Text('Stok fisik (hasil hitung)', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              TextField(
                key: const Key('opname-physical'),
                controller: _physical,
                enabled: !_busy,
                onChanged: (_) => setState(() {}),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                decoration: const InputDecoration(hintText: 'Mis. 12'),
              ),
              if (system != null && physical != null) ...[
                const SizedBox(height: 10),
                Container(
                  key: const Key('opname-preview'),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: AppColors.mist, borderRadius: BorderRadius.circular(AppRadius.md)),
                  child: Text(
                    physical == system
                        ? 'Sama dengan sistem (${_n(system)}), tidak ada perubahan.'
                        : 'Sistem ${_n(system)} → fisik ${_n(physical)} (selisih ${physical - system > 0 ? '+' : ''}${_n(physical - system)})',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              const Text('Catatan (opsional)', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              TextField(
                controller: _note,
                enabled: !_busy,
                maxLines: 2,
                decoration: const InputDecoration(hintText: 'Mis. opname akhir bulan'),
              ),
              const SizedBox(height: 24),
              SizedBox(
                height: 52,
                child: FilledButton.icon(
                  key: const Key('opname-submit'),
                  onPressed: valid ? _submit : null,
                  icon: const Icon(Icons.fact_check_outlined),
                  label: Text(_busy ? 'Menyimpan...' : 'Simpan Opname'),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
