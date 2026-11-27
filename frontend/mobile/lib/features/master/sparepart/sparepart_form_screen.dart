import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/form_field.dart';
import '../../../core/widgets/form_scaffold.dart';
import '../../../data/models/sparepart.dart';
import '../../stock/stock_providers.dart';
import '../master_providers.dart';
import '../../../core/utils/error_message.dart';
import '../../../core/router/app_router.dart' show currentUserProvider;
import '../../../data/models/app_user.dart';

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

  /// Gudang: harga jual saja; harga modal & status aktif urusan admin.
  bool get _isGudang => ref.read(currentUserProvider).valueOrNull?.role == UserRole.gudang;

  @override
  void initState() {
    super.initState();
    final s = widget.initial;
    _name = TextEditingController(text: s?.name ?? '');
    _sku = TextEditingController(text: s?.sku ?? '');
    _buyPrice = TextEditingController();
    _sellPrice = TextEditingController(
      text: s == null ? '' : formatRupiahInput(s.sellPrice),
    );
    _stock = TextEditingController();
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

  String? _numValidator(String? v) {
    if (v == null || v.trim().isEmpty) return 'Wajib diisi';
    return num.tryParse(v.trim()) == null ? 'Harus berupa angka' : null;
  }

  /// "2,5" dan "2.5" sama-sama diterima; kosong = 0.
  num get _initialStock => num.tryParse(_stock.text.trim().replaceAll(',', '.')) ?? 0;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    // Stok awal hanya untuk sparepart baru; sesudahnya lewat Stok Masuk.
    final initialQty = _isEdit ? 0 : _initialStock;
    final buyPrice = parseRupiahInput(_buyPrice.text);
    setState(() => _busy = true);
    final sparepart = Sparepart(
      id: widget.initial?.id ?? '',
      name: _name.text.trim(),
      sku: _sku.text.trim(),
      category: _category,
      unit: _unit,
      buyPrice: widget.initial?.buyPrice ?? 0,
      sellPrice: parseRupiahInput(_sellPrice.text),
      stock: widget.initial?.stock ?? 0,
      minStock: num.parse(_minStock.text.trim()),
      active: _active,
    );
    final repo = ref.read(sparepartRepositoryProvider);
    final stockIn = ref.read(stockInCallerProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      var message = _isGudang && sparepart.sellPrice == 0
          ? 'Tersimpan, menunggu harga dari admin.'
          : 'Sparepart tersimpan.';
      var failed = false;
      if (_isEdit) {
        await repo.update(widget.initial!.id, sparepart);
      } else {
        final id = await repo.create(sparepart);
        // Sparepart sudah ada. Kegagalan sesudah titik ini tidak boleh menahan
        // pengguna di form, karena menekan Simpan lagi membuat yang kedua.
        try {
          // POST /spareparts selalu membuat aktif, PATCH bisa mematikannya.
          if (!_isGudang && !_active) await repo.update(id, sparepart);
          if (initialQty > 0) {
            await stockIn({
              'kind': 'sparepart',
              'refId': id,
              'qty': initialQty,
              if (!_isGudang) 'buyPrice': buyPrice,
              'note': 'Stok awal',
            });
          }
        } catch (e) {
          failed = true;
          message = 'Sparepart tersimpan, tetapi stok awal atau statusnya gagal: '
              '${errorMessage(e)}. Lengkapi lewat Edit atau Stok Masuk.';
        }
      }
      ref.invalidate(sparepartListProvider);
      ref.invalidate(stockOverviewProvider);
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(message),
        backgroundColor: failed ? AppColors.danger : null,
      ));
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
    // Ikut dibangun ulang saat peran selesai dimuat (lihat _isGudang).
    ref.watch(currentUserProvider);
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
            AppMoneyField(
              key: const Key('sellPrice'),
              label: 'Harga Jual',
              required: !_isGudang,
              helper: _isGudang ? 'Boleh dikosongkan, admin yang mengisi' : null,
              controller: _sellPrice,
              enabled: !_busy,
              validator: _isGudang ? null : rupiahRequiredValidator,
            ),
            const SizedBox(height: kFieldGap),
            if (_isEdit)
              const Text('Stok dan harga modal diatur lewat Stok Masuk.')
            else
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: AppNumberField(
                      key: const Key('stock'),
                      label: 'Stok Awal',
                      decimal: true,
                      hint: '0',
                      suffixText: _unit,
                      controller: _stock,
                      enabled: !_busy,
                      validator: (v) => (v ?? '').trim().isEmpty ||
                              num.tryParse(v!.trim().replaceAll(',', '.')) != null
                          ? null
                          : 'Harus berupa angka',
                    ),
                  ),
                  if (!_isGudang) ...[
                  const SizedBox(width: 16),
                  Expanded(
                    child: AppMoneyField(
                      key: const Key('buyPrice'),
                      label: 'Harga Modal',
                      helper: 'Wajib bila ada stok awal',
                      controller: _buyPrice,
                      enabled: !_busy,
                      validator: (v) => _initialStock > 0 ? rupiahRequiredValidator(v) : null,
                    ),
                  ),
                  ],
                ],
              ),
            const SizedBox(height: kFieldGap),
            AppNumberField(
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
            const SizedBox(height: kFieldGap),
            if (!_isGudang)
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
