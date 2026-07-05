import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../data/models/sparepart.dart';
import '../master_providers.dart';

class SparepartFormScreen extends ConsumerStatefulWidget {
  const SparepartFormScreen({super.key, this.initial});

  final Sparepart? initial;

  @override
  ConsumerState<SparepartFormScreen> createState() =>
      _SparepartFormScreenState();
}

class _SparepartFormScreenState extends ConsumerState<SparepartFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _sku;
  late final TextEditingController _buyPrice;
  late final TextEditingController _sellPrice;
  late final TextEditingController _stock;
  late final TextEditingController _minStock;
  late String _category;
  late String _unit;
  late bool _active;
  bool _busy = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final s = widget.initial;
    _name = TextEditingController(text: s?.name ?? '');
    _sku = TextEditingController(text: s?.sku ?? '');
    _buyPrice = TextEditingController(text: s == null ? '' : '${s.buyPrice}');
    _sellPrice = TextEditingController(text: s == null ? '' : '${s.sellPrice}');
    _stock = TextEditingController(text: s == null ? '' : '${s.stock}');
    _minStock = TextEditingController(text: s == null ? '' : '${s.minStock}');
    _category = s?.category ?? kSparepartCategories.first;
    _unit = s?.unit ?? kUnits.first;
    _active = s?.active ?? true;
  }

  @override
  void dispose() {
    _name.dispose();
    _sku.dispose();
    _buyPrice.dispose();
    _sellPrice.dispose();
    _stock.dispose();
    _minStock.dispose();
    super.dispose();
  }

  String? _requiredValidator(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null;

  String? _intValidator(String? v) {
    if (v == null || v.trim().isEmpty) return 'Wajib diisi';
    return int.tryParse(v.trim()) == null ? 'Harus berupa angka' : null;
  }

  String? _numValidator(String? v) {
    if (v == null || v.trim().isEmpty) return 'Wajib diisi';
    return num.tryParse(v.trim()) == null ? 'Harus berupa angka' : null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final sparepart = Sparepart(
      id: widget.initial?.id ?? '',
      name: _name.text.trim(),
      sku: _sku.text.trim(),
      category: _category,
      unit: _unit,
      buyPrice: int.parse(_buyPrice.text.trim()),
      sellPrice: int.parse(_sellPrice.text.trim()),
      stock: num.parse(_stock.text.trim()),
      minStock: num.parse(_minStock.text.trim()),
      active: _active,
    );
    final repo = ref.read(sparepartRepositoryProvider);
    try {
      if (_isEdit) {
        await repo.update(widget.initial!.id, sparepart);
      } else {
        await repo.create(sparepart);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sparepart tersimpan.')),
      );
      context.go('/spareparts');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Gagal menyimpan: $e'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Edit Sparepart' : 'Tambah Sparepart'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              key: const Key('name'),
              controller: _name,
              decoration: const InputDecoration(labelText: 'Nama'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('sku'),
              controller: _sku,
              decoration: const InputDecoration(labelText: 'SKU'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const Key('category'),
              value: _category,
              decoration: const InputDecoration(labelText: 'Kategori'),
              items: [
                for (final c in kSparepartCategories)
                  DropdownMenuItem(value: c, child: Text(c)),
              ],
              onChanged: (v) => setState(() => _category = v ?? _category),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const Key('unit'),
              value: _unit,
              decoration: const InputDecoration(labelText: 'Satuan'),
              items: [
                for (final u in kUnits)
                  DropdownMenuItem(value: u, child: Text(u)),
              ],
              onChanged: (v) => setState(() => _unit = v ?? _unit),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('buyPrice'),
              controller: _buyPrice,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Harga Beli'),
              validator: _intValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('sellPrice'),
              controller: _sellPrice,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Harga Jual'),
              validator: _intValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('stock'),
              controller: _stock,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
              ],
              decoration: const InputDecoration(labelText: 'Stok'),
              validator: _numValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('minStock'),
              controller: _minStock,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
              ],
              decoration: const InputDecoration(labelText: 'Stok Minimum'),
              validator: _numValidator,
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              key: const Key('active'),
              title: const Text('Aktif'),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
            const SizedBox(height: 24),
            FilledButton(
              key: const Key('submit'),
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Simpan'),
            ),
          ],
        ),
      ),
    );
  }
}
