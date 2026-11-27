import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/form_field.dart';
import '../../../core/widgets/form_scaffold.dart';
import '../../../data/models/product.dart';
import '../../stock/stock_providers.dart';
import '../master_providers.dart';
import '../../../core/utils/error_message.dart';
import '../../../core/widgets/pk_check.dart';
import '../../../core/router/app_router.dart' show currentUserProvider;
import '../../../data/models/app_user.dart';

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

  /// Gudang: harga jual saja; harga modal & status aktif urusan admin.
  bool get _isGudang => ref.read(currentUserProvider).valueOrNull?.role == UserRole.gudang;

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
    _buyPrice = TextEditingController();
    _sellPrice = TextEditingController(
      text: p == null ? '' : formatRupiahInput(p.sellPrice),
    );
    _stock = TextEditingController();
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
    if (!await confirmPk(context, [_pk.text]) || !mounted) return;
    // Stok awal hanya untuk produk baru; sesudahnya lewat Stok Masuk.
    final initialQty = _isEdit ? 0 : int.tryParse(_stock.text.trim()) ?? 0;
    final buyPrice = parseRupiahInput(_buyPrice.text);
    // Ditanyakan sebelum apa pun tersimpan, supaya Batal benar-benar batal.
    if (!_isGudang && initialQty > 0 && buyPrice >= parseRupiahInput(_sellPrice.text)) {
      if (!await _confirmBelowCost() || !mounted) return;
    }
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
      buyPrice: widget.initial?.buyPrice ?? 0,
      sellPrice: parseRupiahInput(_sellPrice.text),
      stock: widget.initial?.stock ?? 0,
      photoUrl: widget.initial?.photoUrl,
      description: descText.isEmpty ? null : descText,
      category: _category,
      active: _active,
    );
    final repo = ref.read(productRepositoryProvider);
    final stockIn = ref.read(stockInCallerProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      var message = _isGudang && product.sellPrice == 0
          ? 'Tersimpan, menunggu harga dari admin.'
          : 'Produk tersimpan.';
      var failed = false;
      if (_isEdit) {
        await repo.update(widget.initial!.id, product);
      } else {
        final id = await repo.create(product);
        // Produk sudah ada. Kegagalan sesudah titik ini tidak boleh menahan
        // pengguna di form, karena menekan Simpan lagi membuat produk kedua.
        try {
          // POST /products tidak menerima kolom ini, PATCH menerimanya.
          if (!_isGudang && (warrantyText.isNotEmpty || descText.isNotEmpty || !_active)) {
            await repo.update(id, product);
          }
          if (initialQty > 0) {
            await stockIn({
              'kind': 'product',
              'refId': id,
              'qty': initialQty,
              if (!_isGudang) 'buyPrice': buyPrice,
              'note': 'Stok awal',
              'confirmOverride': true,
            });
          }
        } catch (e) {
          failed = true;
          message = 'Produk tersimpan, tetapi stok awal atau detailnya gagal: '
              '${errorMessage(e)}. Lengkapi lewat Edit atau Stok Masuk.';
        }
      }
      ref.invalidate(productListProvider);
      ref.invalidate(stockOverviewProvider);
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(message),
        backgroundColor: failed ? AppColors.danger : null,
      ));
      context.go('/products');
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

  Future<bool> _confirmBelowCost() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Harga modal tidak di bawah harga jual'),
        content: const Text('Tetap simpan produk beserta stok awalnya?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Batal')),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Tetap Simpan')),
        ],
      ),
    );
    return ok ?? false;
  }

  @override
  Widget build(BuildContext context) {
    // Ikut dibangun ulang saat peran selesai dimuat (lihat _isGudang).
    ref.watch(currentUserProvider);
    return AppFormScaffold(
      title: _isEdit ? 'Edit Produk' : 'Tambah Produk',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Simpan',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      // Dua belas kolom dipecah jadi tiga kelompok. Satu kartu berisi semuanya
      // tidak memberi tahu apa pun tentang isinya, dan pengguna kehilangan
      // tempat begitu menggulir melewati layar pertama.
      children: [
        AppFormCard(
          title: 'Identitas Produk',
          children: [
            AppTextField(
              key: const Key('name'),
              label: 'Nama',
              required: true,
              hint: 'Contoh: AC Split 1 PK Inverter',
              controller: _name,
              enabled: !_busy,
              validator: _requiredValidator,
            ),
            const SizedBox(height: kFieldGap),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: AppTextField(
                    key: const Key('brand'),
                    label: 'Merek',
                    required: true,
                    controller: _brand,
                    enabled: !_busy,
                    validator: _requiredValidator,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppTextField(
                    key: const Key('type'),
                    label: 'Tipe',
                    required: true,
                    controller: _type,
                    enabled: !_busy,
                    validator: _requiredValidator,
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            AppSelectField<String>(
              key: const Key('category'),
              label: 'Kategori',
              required: true,
              value: _category,
              enabled: !_busy,
              items: [
                // Sertakan nilai tersimpan meski di luar daftar baku, agar
                // form edit tak crash saat data lama memakai kategori lain.
                for (final c in [
                  ...kProductCategories,
                  if (!kProductCategories.contains(_category)) _category,
                ])
                  DropdownMenuItem(value: c, child: Text(c)),
              ],
              onChanged: (v) => setState(() => _category = v ?? _category),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Spesifikasi',
          subtitle: 'Selain PK, semuanya boleh dikosongkan.',
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: AppNumberField(
                    key: const Key('pk'),
                    label: 'PK',
                    helper: kPkHint,
                    required: true,
                    decimal: true,
                    hint: '1',
                    controller: _pk,
                    enabled: !_busy,
                    validator: _doubleValidator,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppNumberField(
                    key: const Key('btu'),
                    label: 'BTU',
                    hint: '9000',
                    controller: _btu,
                    enabled: !_busy,
                    validator: (v) => _intValidator(v, required: false),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppNumberField(
                    key: const Key('watt'),
                    label: 'Watt',
                    hint: '660',
                    suffixText: 'W',
                    controller: _watt,
                    enabled: !_busy,
                    validator: (v) => _intValidator(v, required: false),
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('warranty'),
              label: 'Garansi',
              hint: 'Mis. 1 tahun unit, 5 tahun kompresor',
              controller: _warranty,
              enabled: !_busy,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('description'),
              label: 'Deskripsi',
              hint: 'Catatan tambahan tentang produk ini...',
              maxLines: 3,
              controller: _description,
              enabled: !_busy,
            ),
            const SizedBox(height: kFieldGap),
            AppSwitchTile(
              key: const Key('inverter'),
              title: 'Inverter',
              subtitle: 'Kompresor berkecepatan variabel.',
              value: _inverter,
              onChanged: _busy ? null : (v) => setState(() => _inverter = v),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Harga & Stok',
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
                      hint: '0',
                      suffixText: 'unit',
                      controller: _stock,
                      enabled: !_busy,
                      validator: (v) => _intValidator(v, required: false),
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
                      validator: (v) =>
                          (int.tryParse(_stock.text.trim()) ?? 0) > 0
                              ? rupiahRequiredValidator(v)
                              : null,
                    ),
                  ),
                  ],
                ],
              ),
            const SizedBox(height: kFieldGap),
            if (!_isGudang)
            AppSwitchTile(
              key: const Key('active'),
              title: 'Produk Aktif',
              subtitle: 'Tampil di pilihan kasir dan teknisi.',
              value: _active,
              onChanged: _busy ? null : (v) => setState(() => _active = v),
            ),
          ],
        ),
      ],
    );
  }
}
