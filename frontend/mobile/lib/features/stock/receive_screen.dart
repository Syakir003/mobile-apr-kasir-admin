import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/form_field.dart';
import 'receive_providers.dart';
import 'stock_label_pdf.dart';
import 'stock_providers.dart' show stockOverviewProvider;

/// Terima Barang: gudang mencatat barang datang TANPA harga, lalu mencetak
/// label. Harga modal diisi admin lewat Modal Barang (web).
class ReceiveScreen extends ConsumerStatefulWidget {
  const ReceiveScreen({super.key});

  @override
  ConsumerState<ReceiveScreen> createState() => _ReceiveScreenState();
}

class _ReceiveScreenState extends ConsumerState<ReceiveScreen> {
  String? _itemId;
  final _qty = TextEditingController();
  final _outdoorQty = TextEditingController();
  final _supplier = TextEditingController();
  final _rolls = <TextEditingController>[TextEditingController()];
  bool _busy = false;

  /// Terisi sesudah tersimpan: layar berganti ke ringkasan supaya tidak dobel.
  Map<String, dynamic>? _saved;
  ReceiveItem? _savedItem;

  @override
  void dispose() {
    for (final c in [_qty, _outdoorQty, _supplier, ..._rolls]) {
      c.dispose();
    }
    super.dispose();
  }

  static num _parse(TextEditingController c) =>
      num.tryParse(c.text.trim().replaceAll(',', '.')) ?? 0;

  List<num> get _rollValues => [
        for (final r in _rolls)
          if (_parse(r) > 0) _parse(r),
      ];

  bool _valid(ReceiveItem item) {
    if (item.batchTracked) return _rollValues.isNotEmpty;
    final qty = _parse(_qty);
    final out = item.outdoorId == null ? 0 : _parse(_outdoorQty);
    // Unit AC dihitung bulat.
    if (item.kind == 'product' && (qty != qty.truncate() || out != out.truncate())) return false;
    return qty >= 0 && out >= 0 && qty + out > 0;
  }

  Future<void> _save(ReceiveItem item) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final res = await ref.read(receiveCallerProvider)(buildReceivePayload(
        item,
        qty: _parse(_qty),
        outdoorQty: _parse(_outdoorQty),
        rolls: _rollValues,
        supplier: _supplier.text,
      ));
      ref.invalidate(stockOverviewProvider);
      if (!mounted) return;
      setState(() {
        _saved = res;
        _savedItem = item;
      });
    } catch (e) {
      messenger.showSnackBar(
          SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _print() async {
    final res = _saved!;
    final paired = _savedItem!.outdoorId != null;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await printBatchLabels([
        if (res['batchId'] != null)
          (batchId: '${res['batchId']}', name: '${res['name']}', role: paired ? 'indoor' : null),
        if (res['outdoorBatchId'] != null)
          (batchId: '${res['outdoorBatchId']}', name: '${res['outdoorName']}', role: 'outdoor'),
      ]);
    } catch (e) {
      messenger.showSnackBar(
          SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _reset() => setState(() {
        _saved = null;
        _savedItem = null;
        _itemId = null;
        for (final c in [_qty, _outdoorQty, _supplier]) {
          c.clear();
        }
        for (final r in _rolls.skip(1).toList()) {
          _rolls.remove(r);
          r.dispose();
        }
        _rolls.first.clear();
      });

  Widget _number(String key, String label, TextEditingController c, String suffix) => Padding(
        padding: const EdgeInsets.only(bottom: kFieldGap),
        child: AppNumberField(
          key: Key(key),
          label: label,
          decimal: true,
          hint: '0',
          suffixText: suffix,
          controller: c,
          enabled: !_busy,
          onChanged: (_) => setState(() {}),
        ),
      );

  Widget _summary() {
    final item = _savedItem!;
    final hasLabels = _saved!['batchId'] != null || _saved!['outdoorBatchId'] != null;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Icon(Icons.check_circle_outline, size: 48),
        const SizedBox(height: 12),
        Text('${item.name} tercatat. Harga modal akan diisi admin.', textAlign: TextAlign.center),
        const SizedBox(height: 24),
        if (item.kind == 'product' && hasLabels) ...[
          FilledButton.icon(
            key: const Key('receive-print'),
            onPressed: _busy ? null : _print,
            icon: const Icon(Icons.print_outlined),
            label: const Text('Cetak Label'),
          ),
          const SizedBox(height: 8),
        ],
        OutlinedButton(
          key: const Key('receive-again'),
          onPressed: _busy ? null : _reset,
          child: const Text('Terima Barang Lain'),
        ),
      ],
    );
  }

  Widget _form(List<ReceiveItem> items) {
    final item = items.where((i) => i.id == _itemId).firstOrNull;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        AppSelectField<String>(
          key: const Key('receive-item'),
          label: 'Barang',
          required: true,
          value: item?.id,
          enabled: !_busy,
          items: [
            for (final i in items) DropdownMenuItem(value: i.id, child: Text(i.name, overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (v) => setState(() => _itemId = v),
        ),
        const SizedBox(height: kFieldGap),
        if (item != null) ...[
          if (item.batchTracked) ...[
            for (var i = 0; i < _rolls.length; i++)
              _number('receive-roll-$i', 'Panjang gulungan ${i + 1}', _rolls[i], item.unit),
            TextButton.icon(
              key: const Key('receive-add-roll'),
              onPressed: _busy ? null : () => setState(() => _rolls.add(TextEditingController())),
              icon: const Icon(Icons.add),
              label: const Text('Tambah gulungan'),
            ),
          ] else if (item.outdoorId != null) ...[
            _number('receive-qty', 'Jumlah Indoor', _qty, item.unit),
            _number('receive-outdoor-qty', 'Jumlah Outdoor', _outdoorQty, item.unit),
          ] else
            _number('receive-qty', 'Jumlah', _qty, item.unit),
          AppTextField(
            key: const Key('receive-supplier'),
            label: 'Pemasok',
            hint: 'Opsional',
            controller: _supplier,
            enabled: !_busy,
          ),
          const SizedBox(height: 20),
          FilledButton(
            key: const Key('receive-save'),
            onPressed: _busy || !_valid(item) ? null : () => _save(item),
            child: const Text('Simpan'),
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final items = ref.watch(receiveItemsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Terima Barang')),
      body: _saved != null
          ? _summary()
          : items.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text(errorMessage(e))),
              data: _form,
            ),
    );
  }
}
