import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../data/models/installation_package.dart';
import '../../../data/models/sparepart.dart';
import '../master_providers.dart';

class PackageFormScreen extends ConsumerStatefulWidget {
  const PackageFormScreen({super.key, this.initial});

  final InstallationPackage? initial;

  @override
  ConsumerState<PackageFormScreen> createState() => _PackageFormScreenState();
}

class _PackageFormScreenState extends ConsumerState<PackageFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _description;
  late bool _active;
  late List<PackageItem> _items;
  bool _busy = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final p = widget.initial;
    _name = TextEditingController(text: p?.name ?? '');
    _description = TextEditingController(text: p?.description ?? '');
    _active = p?.active ?? true;
    _items = List<PackageItem>.from(p?.items ?? const []);
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  String? _requiredValidator(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null;

  Future<void> _addItem(List<Sparepart> spareparts) async {
    if (spareparts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Belum ada sparepart. Tambahkan dulu.')),
      );
      return;
    }
    final result = await showDialog<PackageItem>(
      context: context,
      builder: (_) => _PackageItemDialog(spareparts: spareparts),
    );
    if (result != null && mounted) {
      setState(() => _items = [..._items, result]);
    }
  }

  void _removeItem(int index) {
    setState(() {
      final next = List<PackageItem>.from(_items)..removeAt(index);
      _items = next;
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final descText = _description.text.trim();
    final package = InstallationPackage(
      id: widget.initial?.id ?? '',
      name: _name.text.trim(),
      description: descText.isEmpty ? null : descText,
      items: _items,
      active: _active,
    );
    final repo = ref.read(packageRepositoryProvider);
    try {
      if (_isEdit) {
        await repo.update(widget.initial!.id, package);
      } else {
        await repo.create(package);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Paket tersimpan.')),
      );
      context.go('/packages');
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
    final sparepartsAsync = ref.watch(sparepartListProvider);
    final spareparts = sparepartsAsync.value ?? const <Sparepart>[];
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit Paket' : 'Tambah Paket')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              key: const Key('name'),
              controller: _name,
              decoration: const InputDecoration(labelText: 'Nama Paket'),
              validator: _requiredValidator,
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
              key: const Key('active'),
              title: const Text('Aktif'),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
            const Divider(height: 32),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Item Paket',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                TextButton.icon(
                  key: const Key('add-item'),
                  onPressed: () => _addItem(spareparts),
                  icon: const Icon(Icons.add),
                  label: const Text('Tambah Item'),
                ),
              ],
            ),
            if (_items.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text('Belum ada item.'),
              )
            else
              for (var i = 0; i < _items.length; i++)
                Card(
                  child: ListTile(
                    title: Text(_items[i].name),
                    subtitle: Text(
                      '${_items[i].qty} ${_items[i].unit} • Rp ${_items[i].extraPricePerUnit}/unit',
                    ),
                    trailing: IconButton(
                      key: Key('remove-item-$i'),
                      icon: const Icon(Icons.delete_outline),
                      color: AppColors.danger,
                      onPressed: () => _removeItem(i),
                    ),
                  ),
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

/// Dialog untuk memilih sparepart, qty, dan harga ekstra per unit.
class _PackageItemDialog extends StatefulWidget {
  const _PackageItemDialog({required this.spareparts});

  final List<Sparepart> spareparts;

  @override
  State<_PackageItemDialog> createState() => _PackageItemDialogState();
}

class _PackageItemDialogState extends State<_PackageItemDialog> {
  final _formKey = GlobalKey<FormState>();
  late Sparepart _selected;
  final _qty = TextEditingController(text: '1');
  late final TextEditingController _extraPrice;

  @override
  void initState() {
    super.initState();
    _selected = widget.spareparts.first;
    _extraPrice = TextEditingController(text: '${_selected.sellPrice}');
  }

  @override
  void dispose() {
    _qty.dispose();
    _extraPrice.dispose();
    super.dispose();
  }

  void _onSparepartChanged(Sparepart? s) {
    if (s == null) return;
    setState(() {
      _selected = s;
      // Harga ekstra otomatis dari sellPrice sparepart (bisa diedit lagi).
      _extraPrice.text = '${s.sellPrice}';
    });
  }

  String? _numValidator(String? v) {
    if (v == null || v.trim().isEmpty) return 'Wajib diisi';
    return num.tryParse(v.trim()) == null ? 'Harus berupa angka' : null;
  }

  String? _intValidator(String? v) {
    if (v == null || v.trim().isEmpty) return 'Wajib diisi';
    return int.tryParse(v.trim()) == null ? 'Harus berupa angka' : null;
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop(
      PackageItem(
        sparepartId: _selected.id,
        name: _selected.name,
        qty: num.parse(_qty.text.trim()),
        unit: _selected.unit,
        extraPricePerUnit: int.parse(_extraPrice.text.trim()),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Tambah Item'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<Sparepart>(
              key: const Key('item-sparepart'),
              initialValue: _selected,
              decoration: const InputDecoration(labelText: 'Sparepart'),
              items: [
                for (final s in widget.spareparts)
                  DropdownMenuItem(value: s, child: Text(s.name)),
              ],
              onChanged: _onSparepartChanged,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('item-qty'),
              controller: _qty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
              ],
              decoration: InputDecoration(
                labelText: 'Qty (${_selected.unit})',
              ),
              validator: _numValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('item-extra-price'),
              controller: _extraPrice,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration:
                  const InputDecoration(labelText: 'Harga Ekstra / unit'),
              validator: _intValidator,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Batal'),
        ),
        FilledButton(
          key: const Key('item-save'),
          onPressed: _save,
          child: const Text('Tambah'),
        ),
      ],
    );
  }
}
