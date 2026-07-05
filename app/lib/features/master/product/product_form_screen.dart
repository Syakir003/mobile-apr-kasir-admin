import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../data/models/product.dart';
import '../master_providers.dart';

class ProductFormScreen extends ConsumerStatefulWidget {
  const ProductFormScreen({super.key, this.initial});

  final Product? initial;

  @override
  ConsumerState<ProductFormScreen> createState() => _ProductFormScreenState();
}

class _ProductFormScreenState extends ConsumerState<ProductFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _brand;
  late final TextEditingController _type;
  late final TextEditingController _pk;
  late final TextEditingController _btu;
  late final TextEditingController _watt;
  late final TextEditingController _warranty;
  late final TextEditingController _buyPrice;
  late final TextEditingController _sellPrice;
  late final TextEditingController _stock;
  late final TextEditingController _description;
  late bool _inverter;
  late String _category;
  late bool _active;
  bool _busy = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final p = widget.initial;
    _name = TextEditingController(text: p?.name ?? '');
    _brand = TextEditingController(text: p?.brand ?? '');
    _type = TextEditingController(text: p?.type ?? '');
    _pk = TextEditingController(text: p == null ? '' : '${p.pk}');
    _btu = TextEditingController(text: p?.btu?.toString() ?? '');
    _watt = TextEditingController(text: p?.watt?.toString() ?? '');
    _warranty = TextEditingController(text: p?.warranty ?? '');
    _buyPrice = TextEditingController(text: p == null ? '' : '${p.buyPrice}');
    _sellPrice = TextEditingController(text: p == null ? '' : '${p.sellPrice}');
    _stock = TextEditingController(text: p == null ? '' : '${p.stock}');
    _description = TextEditingController(text: p?.description ?? '');
    _inverter = p?.inverter ?? false;
    _category = p?.category ?? kProductCategories.first;
    _active = p?.active ?? true;
  }

  @override
  void dispose() {
    _name.dispose();
    _brand.dispose();
    _type.dispose();
    _pk.dispose();
    _btu.dispose();
    _watt.dispose();
    _warranty.dispose();
    _buyPrice.dispose();
    _sellPrice.dispose();
    _stock.dispose();
    _description.dispose();
    super.dispose();
  }

  String? _requiredValidator(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null;

  String? _intValidator(String? v, {bool required = true}) {
    if (v == null || v.trim().isEmpty) {
      return required ? 'Wajib diisi' : null;
    }
    return int.tryParse(v.trim()) == null ? 'Harus berupa angka' : null;
  }

  String? _doubleValidator(String? v) {
    if (v == null || v.trim().isEmpty) return 'Wajib diisi';
    return double.tryParse(v.trim()) == null ? 'Harus berupa angka' : null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final btuText = _btu.text.trim();
    final wattText = _watt.text.trim();
    final warrantyText = _warranty.text.trim();
    final descText = _description.text.trim();
    final product = Product(
      id: widget.initial?.id ?? '',
      name: _name.text.trim(),
      brand: _brand.text.trim(),
      type: _type.text.trim(),
      pk: double.parse(_pk.text.trim()),
      inverter: _inverter,
      btu: btuText.isEmpty ? null : int.parse(btuText),
      watt: wattText.isEmpty ? null : int.parse(wattText),
      warranty: warrantyText.isEmpty ? null : warrantyText,
      buyPrice: int.parse(_buyPrice.text.trim()),
      sellPrice: int.parse(_sellPrice.text.trim()),
      stock: int.parse(_stock.text.trim()),
      photoUrl: widget.initial?.photoUrl,
      description: descText.isEmpty ? null : descText,
      category: _category,
      active: _active,
    );
    final repo = ref.read(productRepositoryProvider);
    try {
      if (_isEdit) {
        await repo.update(widget.initial!.id, product);
      } else {
        await repo.create(product);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Produk tersimpan.')),
      );
      context.go('/products');
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
      appBar: AppBar(title: Text(_isEdit ? 'Edit Produk' : 'Tambah Produk')),
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
              key: const Key('brand'),
              controller: _brand,
              decoration: const InputDecoration(labelText: 'Merek'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('type'),
              controller: _type,
              decoration: const InputDecoration(labelText: 'Tipe'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const Key('category'),
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'Kategori'),
              items: [
                for (final c in kProductCategories)
                  DropdownMenuItem(value: c, child: Text(c)),
              ],
              onChanged: (v) => setState(() => _category = v ?? _category),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('pk'),
              controller: _pk,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
              ],
              decoration: const InputDecoration(labelText: 'PK'),
              validator: _doubleValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('btu'),
              controller: _btu,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'BTU (opsional)'),
              validator: (v) => _intValidator(v, required: false),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('watt'),
              controller: _watt,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Watt (opsional)'),
              validator: (v) => _intValidator(v, required: false),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('warranty'),
              controller: _warranty,
              decoration: const InputDecoration(labelText: 'Garansi (opsional)'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('buyPrice'),
              controller: _buyPrice,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Harga Beli'),
              validator: (v) => _intValidator(v),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('sellPrice'),
              controller: _sellPrice,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Harga Jual'),
              validator: (v) => _intValidator(v),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('stock'),
              controller: _stock,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Stok'),
              validator: (v) => _intValidator(v),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('description'),
              controller: _description,
              maxLines: 3,
              decoration:
                  const InputDecoration(labelText: 'Deskripsi (opsional)'),
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              key: const Key('inverter'),
              title: const Text('Inverter'),
              value: _inverter,
              onChanged: (v) => setState(() => _inverter = v),
            ),
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
