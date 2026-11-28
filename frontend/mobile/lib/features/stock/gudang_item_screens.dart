import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/num_parse.dart';
import '../../core/widgets/form_field.dart';
import '../../data/models/product.dart' show kProductCategories;
import '../master/master_providers.dart';
import 'product_opname.dart' show productOpnameCallerProvider, productReservedProvider;
import 'receive_providers.dart';
import 'receive_screen.dart' show ReceiveFields, ReceivedLabelButton;
import 'stock_opname_screen.dart';

// Dua layar gudang dari detail barang: Barang Masuk dan Edit. Keduanya menutup diri sesudah selesai.

String _n(num v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

class GudangStockInScreen extends StatefulWidget {
  const GudangStockInScreen({super.key, required this.item});

  final ReceiveItem item;

  @override
  State<GudangStockInScreen> createState() => _GudangStockInScreenState();
}

class _GudangStockInScreenState extends State<GudangStockInScreen> {
  /// Terisi untuk produk AC: tetap di layar ini supaya labelnya bisa dicetak.
  Map<String, dynamic>? _saved;

  void _onSaved(Map<String, dynamic> res) {
    const message = 'Barang masuk tersimpan. Harga modal diisi admin.';
    if (widget.item.kind == 'product' && (res['batchId'] != null || res['outdoorBatchId'] != null)) {
      setState(() => _saved = res);
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text(message)));
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return Scaffold(
      appBar: AppBar(title: const Text('Barang Masuk')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(item.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          if (_saved == null)
            ReceiveFields(item: item, onSaved: _onSaved)
          else ...[
            const Text('Barang masuk tersimpan. Cetak labelnya lalu tempel di unit.'),
            const SizedBox(height: 16),
            ReceivedLabelButton(result: _saved!, paired: item.outdoorId != null),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Selesai')),
          ],
        ],
      ),
    );
  }
}

/// Edit barang seperti form input: nama, SKU, kategori, dan isi stok. Harga tidak ada.
/// Angka stok yang diubah dikirim sebagai koreksi stok di belakang layar.
class GudangEditScreen extends ConsumerStatefulWidget {
  const GudangEditScreen({super.key, required this.kind, required this.id, required this.info});

  final String kind; // product | sparepart
  final String id;

  /// Baris barang apa adanya dari server.
  final Map<String, dynamic> info;

  @override
  ConsumerState<GudangEditScreen> createState() => _GudangEditScreenState();
}

class _GudangEditScreenState extends ConsumerState<GudangEditScreen> {
  bool get _isProduct => widget.kind == 'product';
  bool get _perBatch => !_isProduct && widget.info['batchTracked'] == true;

  String _info(String key) => '${widget.info[key] ?? ''}';
  late final num _initialQty = numFromNest(widget.info['stock']) ?? 0;

  late final _name = TextEditingController(text: _info('name'));
  late final _sku = TextEditingController(text: _info('sku'));
  late final _category = TextEditingController(text: _info('category'));
  late final _qty = TextEditingController(text: _n(_initialQty));

  /// Per tabung/gulungan. Angka awal disimpan supaya hanya yang diubah yang dikirim.
  final _batches = <String, ({TextEditingController field, num initial})>{};
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_name, _sku, _category, _qty, for (final b in _batches.values) b.field]) {
      c.dispose();
    }
    super.dispose();
  }

  static num? _parse(TextEditingController c) {
    final v = num.tryParse(c.text.trim().replaceAll(',', '.'));
    return v == null || v < 0 ? null : v;
  }

  bool get _valid {
    if (_name.text.trim().isEmpty) return false;
    if (_perBatch) return _batches.values.every((b) => _parse(b.field) != null);
    final qty = _parse(_qty);
    if (qty == null) return false;
    // Unit AC bulat, dan hanya bisa dikurangi di sini (menambah butuh label).
    return !_isProduct || (qty == qty.truncate() && qty <= _initialQty);
  }

  Map<String, dynamic> get _identity => {
        'name': _name.text.trim(),
        if (!_isProduct) 'sku': _sku.text.trim(),
        'category': _category.text.trim(),
      };

  bool get _identityChanged =>
      _name.text.trim() != _info('name') ||
      (!_isProduct && _sku.text.trim() != _info('sku')) ||
      _category.text.trim() != _info('category');

  List<Map<String, dynamic>> get _sparepartChanges => [
        if (_perBatch)
          for (final e in _batches.entries)
            if (_parse(e.value.field) != e.value.initial)
              ...(buildOpnamePayload(refId: widget.id, batchId: e.key, physicalQty: _parse(e.value.field)!)['items']
                  as List<Map<String, dynamic>>),
        if (!_perBatch && _parse(_qty) != _initialQty)
          ...(buildOpnamePayload(refId: widget.id, physicalQty: _parse(_qty)!)['items'] as List<Map<String, dynamic>>),
      ];

  Future<bool> _confirmReduce(num target) async =>
      await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Kurangi stok AC?'),
          content: Text('Stok dari ${_n(_initialQty)} menjadi ${_n(target)} unit. '
              '${_n(_initialQty - target)} unit yang paling baru masuk dihapus.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Batal')),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Ya, kurangi')),
          ],
        ),
      ) ??
      false;

  Future<void> _showRemoved(List<String> codes) => showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('Cabut label unit ini'),
          content: SingleChildScrollView(child: SelectableText(codes.join('\n'))),
          actions: [
            FilledButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Sudah dicabut')),
          ],
        ),
      );

  Future<void> _save() async {
    final qty = _isProduct ? _parse(_qty)! : _initialQty;
    final reduce = _isProduct && qty < _initialQty;
    if (reduce && !await _confirmReduce(qty)) return;
    if (!mounted) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      final stock = _isProduct ? const <Map<String, dynamic>>[] : _sparepartChanges;
      final changed = _identityChanged || reduce || stock.isNotEmpty;
      if (_identityChanged) {
        await ref.read(editItemCallerProvider)('/${_isProduct ? 'products' : 'spareparts'}/${widget.id}', _identity);
      }
      if (stock.isNotEmpty) await ref.read(stockOpnameCallerProvider)({'items': stock});
      if (reduce) {
        final removed = await ref.read(productOpnameCallerProvider)({
          'items': [
            {'kind': 'product', 'refId': widget.id, 'physicalQty': qty.toInt()},
          ],
        });
        if (mounted && removed.isNotEmpty) await _showRemoved(removed);
      }
      if (changed) messenger.showSnackBar(const SnackBar(content: Text('Perubahan disimpan.')));
      if (mounted) navigator.pop();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _text(String key, String label, TextEditingController c, {String? hint}) => Padding(
        padding: const EdgeInsets.only(bottom: kFieldGap),
        child: AppTextField(
          key: Key(key),
          label: label,
          hint: hint,
          controller: c,
          enabled: !_busy,
          onChanged: (_) => setState(() {}),
        ),
      );

  Widget _number(String key, String label, TextEditingController c, String suffix) => Padding(
        padding: const EdgeInsets.only(bottom: kFieldGap),
        child: AppNumberField(
          key: Key(key),
          label: label,
          decimal: !_isProduct,
          hint: '0',
          suffixText: suffix,
          controller: c,
          enabled: !_busy,
          onChanged: (_) => setState(() {}),
        ),
      );

  List<Widget> _stockFields() {
    if (_perBatch) {
      final pack = _info('packUnit').isEmpty ? 'gulungan' : _info('packUnit');
      final label = '${pack[0].toUpperCase()}${pack.substring(1)}';
      return ref.watch(sparepartBatchesProvider(widget.id)).when(
            loading: () => const [Center(child: CircularProgressIndicator())],
            error: (e, _) => [Text(errorMessage(e), style: const TextStyle(color: AppColors.danger))],
            data: (list) {
              final active = [for (final b in list) if (b.stock > 0 || _batches.containsKey(b.id)) b];
              if (active.isEmpty) return [Text('Belum ada $pack berisi. Tambah lewat Barang Masuk.')];
              return [
                for (final (i, b) in active.indexed)
                  _number(
                    'edit-batch-${b.id}',
                    '$label ${i + 1}',
                    _batches
                        .putIfAbsent(
                            b.id, () => (field: TextEditingController(text: _n(b.stock)), initial: b.stock))
                        .field,
                    _info('unit'),
                  ),
              ];
            },
          );
    }
    final reserved = _isProduct ? ref.watch(productReservedProvider(widget.id)).valueOrNull ?? 0 : 0;
    final qty = _parse(_qty);
    return [
      _number('edit-qty', 'Jumlah', _qty, _isProduct ? 'unit' : _info('unit')),
      if (reserved > 0)
        Text('$reserved unit sudah dipesan invoice. Jangan ikut dihitung.',
            style: const TextStyle(color: AppColors.danger)),
      if (_isProduct && qty != null && qty > _initialQty)
        const Text('Menambah unit lewat Barang Masuk supaya dapat label.',
            style: TextStyle(color: AppColors.danger)),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isProduct ? 'Edit Produk AC' : 'Edit Sparepart')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _text('edit-name', 'Nama', _name),
          if (!_isProduct) ...[
            _text('edit-sku', 'SKU', _sku, hint: 'Opsional'),
            _text('edit-category', 'Kategori', _category, hint: 'Opsional'),
          ] else
            Padding(
              padding: const EdgeInsets.only(bottom: kFieldGap),
              child: AppSelectField<String>(
                key: const Key('edit-category'),
                label: 'Kategori',
                value: _category.text.isEmpty ? null : _category.text,
                enabled: !_busy,
                // Nilai tersimpan ikut disertakan meski di luar daftar baku.
                items: [
                  for (final c in {...kProductCategories, if (_category.text.isNotEmpty) _category.text})
                    DropdownMenuItem(value: c, child: Text(c)),
                ],
                onChanged: (v) => setState(() => _category.text = v ?? _category.text),
              ),
            ),
          const Text('Isi stok', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          ..._stockFields(),
          const SizedBox(height: 20),
          FilledButton(
            key: const Key('edit-save'),
            onPressed: _busy || !_valid ? null : _save,
            child: Text(_busy ? 'Menyimpan...' : 'Simpan'),
          ),
        ],
      ),
    );
  }
}
