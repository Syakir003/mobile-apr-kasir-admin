import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/form_field.dart';
import '../../../core/widgets/form_scaffold.dart';
import '../../../data/models/product.dart';
import '../../../data/repositories/item_cost_repository.dart';
import '../master_providers.dart';
import '../../../core/utils/error_message.dart';

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
    _buyPrice = TextEditingController(
      text: p == null ? '' : formatRupiahInput(p.buyPrice),
    );
    _sellPrice = TextEditingController(
      text: p == null ? '' : formatRupiahInput(p.sellPrice),
    );
    _stock = TextEditingController(text: p == null ? '' : '${p.stock}');
    _description = TextEditingController(text: p?.description ?? '');
    _inverter = p?.inverter ?? false;
    _category = p?.category ?? kProductCategories.first;
    _active = p?.active ?? true;
    if (_isEdit) _loadCost();
  }

  /// Harga modal tinggal di tabel `item_costs` (migrasi 0021), bukan lagi kolom
  /// `products.buy_price` — jadi `widget.initial.buyPrice` selalu 0 dan nilainya
  /// harus diambil sendiri. Gagal baca (mis. peran bukan admin) dibiarkan
  /// senyap: field tetap kosong, dan menyimpan form tak akan menimpanya dengan 0
  /// karena `_submit` hanya menulis biaya saat field-nya benar-benar diisi.
  Future<void> _loadCost() async {
    try {
      final value = await ref
          .read(itemCostRepositoryProvider)
          .fetch(CostKind.product, widget.initial!.id);
      if (!mounted || value == 0) return;
      setState(() => _buyPrice.text = formatRupiahInput(value));
    } catch (_) {
      // Harga modal opsional — form tetap bisa dipakai tanpanya.
    }
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
      buyPrice: parseRupiahInput(_buyPrice.text),
      sellPrice: parseRupiahInput(_sellPrice.text),
      stock: int.parse(_stock.text.trim()),
      photoUrl: widget.initial?.photoUrl,
      description: descText.isEmpty ? null : descText,
      category: _category,
      active: _active,
    );
    final repo = ref.read(productRepositoryProvider);
    try {
      final String id;
      if (_isEdit) {
        id = widget.initial!.id;
        await repo.update(id, product);
      } else {
        id = await repo.create(product);
      }
      // Harga modal disimpan terpisah — baris produk tak lagi punya kolomnya.
      // Hanya ditulis bila field diisi, supaya membuka-lalu-menyimpan form
      // tanpa menyentuh field ini tidak menimpa biaya lama dengan 0.
      if (_buyPrice.text.trim().isNotEmpty) {
        await ref
            .read(itemCostRepositoryProvider)
            .save(CostKind.product, id, parseRupiahInput(_buyPrice.text));
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
          content: Text('Gagal menyimpan: ${errorMessage(e)}'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
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
            AppNumberField(
              key: const Key('stock'),
              label: 'Stok',
              required: true,
              hint: '0',
              suffixText: 'unit',
              controller: _stock,
              enabled: !_busy,
              validator: (v) => _intValidator(v),
            ),
            const SizedBox(height: kFieldGap),
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
