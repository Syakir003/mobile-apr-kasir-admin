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

  /// Terisi sesudah tersimpan: layar berganti ke ringkasan supaya tidak dobel.
  Map<String, dynamic>? _saved;
  ReceiveItem? _savedItem;

  void _reset() => setState(() {
        _saved = null;
        _savedItem = null;
        _itemId = null;
      });

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
          ReceivedLabelButton(result: _saved!, paired: item.outdoorId != null),
          const SizedBox(height: 8),
        ],
        OutlinedButton(
          key: const Key('receive-again'),
          onPressed: _reset,
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
          items: [
            for (final i in items) DropdownMenuItem(value: i.id, child: Text(i.name, overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (v) => setState(() => _itemId = v),
        ),
        const SizedBox(height: kFieldGap),
        if (item != null)
          // Kunci per barang: isian barang sebelumnya tidak terbawa.
          ReceiveFields(
            key: ValueKey(item.id),
            item: item,
            onSaved: (res) => setState(() {
              _saved = res;
              _savedItem = item;
            }),
          ),
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

/// Isian barang masuk satu barang, tanpa harga. Dipakai layar Terima Barang dan
/// detail stok gudang. [onSaved] menerima balikan `POST /stock/in`.
class ReceiveFields extends ConsumerStatefulWidget {
  const ReceiveFields({super.key, required this.item, required this.onSaved});

  final ReceiveItem item;
  final void Function(Map<String, dynamic> result) onSaved;

  @override
  ConsumerState<ReceiveFields> createState() => _ReceiveFieldsState();
}

class _ReceiveFieldsState extends ConsumerState<ReceiveFields> {
  final _qty = TextEditingController();
  final _outdoorQty = TextEditingController();
  final _supplier = TextEditingController();
  final _fullCount = TextEditingController();
  final _rolls = <TextEditingController>[TextEditingController()];
  bool _busy = false;

  ReceiveItem get item => widget.item;
  bool get _hasPack => item.packUnit.isNotEmpty && (item.packSize ?? 0) > 0;

  @override
  void dispose() {
    for (final c in [_qty, _outdoorQty, _supplier, _fullCount, ..._rolls]) {
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

  bool get _valid {
    if (item.batchTracked) return _rollValues.isNotEmpty;
    final qty = _parse(_qty);
    final out = item.outdoorId == null ? 0 : _parse(_outdoorQty);
    // Unit AC dihitung bulat.
    if (item.kind == 'product' && (qty != qty.truncate() || out != out.truncate())) return false;
    return qty >= 0 && out >= 0 && qty + out > 0;
  }

  /// Dibuang sesudah kolomnya lepas dari layar.
  void _disposeLater(TextEditingController c) =>
      WidgetsBinding.instance.addPostFrameCallback((_) => c.dispose());

  /// Sama seperti web: n kemasan penuh menggantikan baris yang masih kosong.
  void _addFull() {
    final n = int.tryParse(_fullCount.text.trim()) ?? 0;
    if (n < 1 || n > 200) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Jumlah harus antara 1 sampai 200.')));
      return;
    }
    final size = item.packSize!;
    final value = size == size.truncate() ? '${size.toInt()}' : '$size';
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      for (final c in _rolls.where((r) => r.text.trim().isEmpty).toList()) {
        _rolls.remove(c);
        _disposeLater(c);
      }
      _rolls.addAll([for (var i = 0; i < n; i++) TextEditingController(text: value)]);
      _fullCount.clear();
    });
  }

  void _removeRoll(int i) => setState(() => _disposeLater(_rolls.removeAt(i)));

  Future<void> _save() async {
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
      if (mounted) widget.onSaved(res);
    } catch (e) {
      messenger.showSnackBar(
          SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

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

  List<Widget> _rollFields() {
    final one = _hasPack ? item.packUnit : 'gulungan';
    final label = _hasPack ? '${one[0].toUpperCase()}${one.substring(1)}' : 'Panjang gulungan';
    return [
      if (_hasPack)
        Padding(
          padding: const EdgeInsets.only(bottom: kFieldGap),
          child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Expanded(
              child: AppNumberField(
                key: const Key('receive-full-count'),
                label: 'Jumlah $one penuh',
                hint: '0',
                suffixText: one,
                controller: _fullCount,
                enabled: !_busy,
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              key: const Key('receive-full-add'),
              onPressed: _busy ? null : _addFull,
              child: const Text('Tambah'),
            ),
          ]),
        ),
      for (var i = 0; i < _rolls.length; i++)
        Row(
          // Kunci per kolom isian: menghapus satu baris tidak menggeser isi baris lain.
          key: ObjectKey(_rolls[i]),
          children: [
            Expanded(child: _number('receive-roll-$i', '$label ${i + 1}', _rolls[i], item.unit)),
            if (_rolls.length > 1)
              IconButton(
                key: Key('receive-remove-roll-$i'),
                tooltip: 'Hapus baris',
                onPressed: _busy ? null : () => _removeRoll(i),
                icon: const Icon(Icons.delete_outline),
              ),
          ],
        ),
      TextButton.icon(
        key: const Key('receive-add-roll'),
        onPressed: _busy ? null : () => setState(() => _rolls.add(TextEditingController())),
        icon: const Icon(Icons.add),
        label: Text(_hasPack ? 'Tambah $one (isi lain)' : 'Tambah gulungan'),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (item.batchTracked)
          ..._rollFields()
        else if (item.outdoorId != null) ...[
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
          onPressed: _busy || !_valid ? null : _save,
          child: const Text('Simpan'),
        ),
      ],
    );
  }
}

/// Cetak label QR untuk batch yang baru diterima.
class ReceivedLabelButton extends StatefulWidget {
  const ReceivedLabelButton({super.key, required this.result, required this.paired});

  final Map<String, dynamic> result;
  final bool paired;

  @override
  State<ReceivedLabelButton> createState() => _ReceivedLabelButtonState();
}

class _ReceivedLabelButtonState extends State<ReceivedLabelButton> {
  bool _busy = false;

  Future<void> _print() async {
    final res = widget.result;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await printBatchLabels([
        if (res['batchId'] != null)
          (batchId: '${res['batchId']}', name: '${res['name']}', role: widget.paired ? 'indoor' : null),
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

  @override
  Widget build(BuildContext context) => FilledButton.icon(
        key: const Key('receive-print'),
        onPressed: _busy ? null : _print,
        icon: const Icon(Icons.print_outlined),
        label: const Text('Cetak Label'),
      );
}
