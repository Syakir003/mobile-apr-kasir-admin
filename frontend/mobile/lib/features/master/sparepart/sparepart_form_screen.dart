import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/form_field.dart';
import '../../../core/widgets/form_scaffold.dart';
import '../../../data/models/sparepart.dart';
import '../../../data/repositories/item_cost_repository.dart';
import '../master_providers.dart';
import '../../../core/utils/error_message.dart';

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
    _buyPrice = TextEditingController(
      text: s == null ? '' : formatRupiahInput(s.buyPrice),
    );
    _sellPrice = TextEditingController(
      text: s == null ? '' : formatRupiahInput(s.sellPrice),
    );
    _stock = TextEditingController(text: s == null ? '' : '${s.stock}');
    _minStock = TextEditingController(text: s == null ? '' : '${s.minStock}');
    _category = s?.category ?? kSparepartCategories.first;
    _unit = s?.unit ?? kUnits.first;
    _active = s?.active ?? true;
    if (_isEdit) _loadCost();
  }

  /// Lihat catatan sama di ProductFormScreen — harga modal pindah ke
  /// `item_costs` (migrasi 0021) dan dimuat terpisah.
  Future<void> _loadCost() async {
    try {
      final value = await ref
          .read(itemCostRepositoryProvider)
          .fetch(CostKind.sparepart, widget.initial!.id);
      if (!mounted || value == 0) return;
      setState(() => _buyPrice.text = formatRupiahInput(value));
    } catch (_) {
      // Harga modal opsional — form tetap bisa dipakai tanpanya.
    }
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
      buyPrice: parseRupiahInput(_buyPrice.text),
      sellPrice: parseRupiahInput(_sellPrice.text),
      stock: num.parse(_stock.text.trim()),
      minStock: num.parse(_minStock.text.trim()),
      active: _active,
    );
    final repo = ref.read(sparepartRepositoryProvider);
    try {
      final String id;
      if (_isEdit) {
        id = widget.initial!.id;
        await repo.update(id, sparepart);
      } else {
        id = await repo.create(sparepart);
      }
      if (_buyPrice.text.trim().isNotEmpty) {
        await ref
            .read(itemCostRepositoryProvider)
            .save(CostKind.sparepart, id, parseRupiahInput(_buyPrice.text));
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
          content: Text('Gagal menyimpan: ${errorMessage(e)}'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppFormScaffold(
      title: _isEdit ? 'Edit Sparepart' : 'Tambah Sparepart',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Simpan',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        AppFormCard(
          title: 'Identitas Sparepart',
          children: [
            AppTextField(
              key: const Key('name'),
              label: 'Nama',
              required: true,
              hint: 'Contoh: Kompresor 1 PK',
              controller: _name,
              enabled: !_busy,
              validator: _requiredValidator,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('sku'),
              label: 'SKU',
              required: true,
              hint: 'Kode unik barang',
              controller: _sku,
              enabled: !_busy,
              validator: _requiredValidator,
            ),
            const SizedBox(height: kFieldGap),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  flex: 2,
                  child: AppSelectField<String>(
                    key: const Key('category'),
                    label: 'Kategori',
                    required: true,
                    value: _category,
                    enabled: !_busy,
                    items: [
                      // Sertakan nilai tersimpan meski di luar daftar baku,
                      // agar form edit tak crash saat data lama memakai
                      // kategori lain.
                      for (final c in [
                        ...kSparepartCategories,
                        if (!kSparepartCategories.contains(_category)) _category,
                      ])
                        DropdownMenuItem(value: c, child: Text(c)),
                    ],
                    onChanged: (v) =>
                        setState(() => _category = v ?? _category),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppSelectField<String>(
                    key: const Key('unit'),
                    label: 'Satuan',
                    required: true,
                    value: _unit,
                    enabled: !_busy,
                    items: [
                      for (final u in kUnits)
                        DropdownMenuItem(value: u, child: Text(u)),
                    ],
                    onChanged: (v) => setState(() => _unit = v ?? _unit),
                  ),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Harga & Stok',
          subtitle: 'Stok di bawah stok minimum muncul di peringatan dashboard.',
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: AppMoneyField(
                    key: const Key('buyPrice'),
                    label: 'Harga Beli',
                    required: true,
                    controller: _buyPrice,
                    enabled: !_busy,
                    validator: rupiahRequiredValidator,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppMoneyField(
                    key: const Key('sellPrice'),
                    label: 'Harga Jual',
                    required: true,
                    controller: _sellPrice,
                    enabled: !_busy,
                    validator: rupiahRequiredValidator,
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: AppNumberField(
                    key: const Key('stock'),
                    label: 'Stok',
                    required: true,
                    decimal: true,
                    hint: '0',
                    suffixText: _unit,
                    controller: _stock,
                    enabled: !_busy,
                    validator: _numValidator,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppNumberField(
                    key: const Key('minStock'),
                    label: 'Stok Minimum',
                    required: true,
                    decimal: true,
                    hint: '0',
                    suffixText: _unit,
                    controller: _minStock,
                    enabled: !_busy,
                    validator: _numValidator,
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            AppSwitchTile(
              key: const Key('active'),
              title: 'Sparepart Aktif',
              subtitle: 'Bisa dipakai di transaksi dan pengajuan material.',
              value: _active,
              onChanged: _busy ? null : (v) => setState(() => _active = v),
            ),
          ],
        ),
      ],
    );
  }
}
