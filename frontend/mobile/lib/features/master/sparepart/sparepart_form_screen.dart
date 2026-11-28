import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/form_field.dart';
import '../../../core/widgets/form_scaffold.dart';
import '../../../core/widgets/app_filter_chip.dart';
import '../../../core/utils/currency.dart';
import '../../../data/models/sparepart_templates.dart';
import '../../../data/models/sparepart.dart';
import '../../stock/stock_providers.dart';
import '../master_providers.dart';
import '../../../core/utils/error_message.dart';
import '../../../core/router/app_router.dart' show currentUserProvider;
import '../../../data/models/app_user.dart';

/// Pertanyaan "dijual bagaimana?" — teks sama dengan web.
const _modes = <(String, String, String)>[
  ('biasa', 'Per biji atau satu ukuran saja', 'Contoh: kapasitor, bracket'),
  ('gabungan', 'Bisa utuh atau diecer, sisa tiap tabung/roll dicatat', 'Contoh: freon per tabung atau per kg, pipa roll'),
  ('konversi', 'Bisa utuh atau diecer, cukup dihitung totalnya', 'Contoh: baut per dus atau per biji'),
  ('gulungan', 'Hanya diecer, sisa tiap roll dicatat', 'Contoh: kabel yang tidak pernah dijual satu roll'),
];

// Pilihan cepat; isiannya tetap bebas diketik, sama seperti web.
const _packUnits = ['tabung', 'roll', 'dus'];
const _smallUnits = ['pcs', 'kg', 'meter', 'liter'];

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
  late final TextEditingController _category;
  late final TextEditingController _unit;
  late bool _active;
  final _packSize = TextEditingController();
  final _sellPricePack = TextEditingController();
  String _mode = 'biasa';
  final _packUnit = TextEditingController();
  bool _inPack = true; // stok awal dihitung per tabung/roll (true) atau per satuan isi

  bool get _packMode => !_isEdit && (_mode == 'gabungan' || _mode == 'konversi');
  num get _packSizeValue => num.tryParse(_packSize.text.trim().replaceAll(',', '.')) ?? 0;

  // Label memakai nama satuan yang diketik, bukan "satuan kecil/besar".
  String get _small => _unit.text.trim().isNotEmpty
      ? _unit.text.trim()
      : (_packMode ? 'kg/meter' : 'satuan');
  String get _big => _packUnit.text.trim().isNotEmpty ? _packUnit.text.trim() : 'tabung/roll';
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
    _category = TextEditingController(text: s?.category ?? '');
    _unit = TextEditingController(text: s?.unit ?? '');
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
    _packSize.dispose();
    _packUnit.dispose();
    _category.dispose();
    _unit.dispose();
    _sellPricePack.dispose();
    super.dispose();
  }

  String? _requiredValidator(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null;

  /// "2,5" dan "2.5" sama-sama diterima; kosong = 0.
  num get _initialStock => num.tryParse(_stock.text.trim().replaceAll(',', '.')) ?? 0;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    // Stok awal hanya untuk sparepart baru; sesudahnya lewat Stok Masuk.
    // Per gulungan: stok awal tidak diisi di sini (lewat Terima Barang, per gulungan).
    final entered = _isEdit || _mode == 'gulungan' ? 0 : _initialStock;
    final perPack = _packMode && _inPack;
    // Selalu dikirim dalam satuan isi; harga modal per tabung ikut dibagi.
    num round2(num v) => (v * 100).round() / 100;
    final num initialQty = round2(perPack ? entered * _packSizeValue : entered);
    final typedPrice = parseRupiahInput(_buyPrice.text);
    final num buyPrice = perPack ? round2(typedPrice / _packSizeValue) : typedPrice;
    setState(() => _busy = true);
    final sparepart = Sparepart(
      id: widget.initial?.id ?? '',
      name: _name.text.trim(),
      sku: _sku.text.trim(),
      category: _category.text.trim(),
      unit: _unit.text.trim(),
      buyPrice: widget.initial?.buyPrice ?? 0,
      sellPrice: parseRupiahInput(_sellPrice.text),
      stock: widget.initial?.stock ?? 0,
      minStock: num.tryParse(_minStock.text.trim().replaceAll(',', '.')) ?? 0,
      trackingMode: _isEdit ? 'biasa' : _mode,
      packUnit: _packMode ? _packUnit.text.trim() : '',
      packSize: _packMode ? _packSizeValue : null,
      sellPricePack: _packMode ? parseRupiahInput(_sellPricePack.text) : 0,
      active: _active,
    );
    final repo = ref.read(sparepartRepositoryProvider);
    final stockIn = ref.read(stockInCallerProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      var message = _isGudang && (sparepart.sellPrice == 0 || (_packMode && sparepart.sellPricePack == 0))
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
              if (_mode == 'gabungan')
                'rolls': _rolls(initialQty, _packSizeValue)
              else
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

  /// Tabung penuh sebanyak mungkin, sisanya satu tabung tidak penuh.
  List<Map<String, num>> _rolls(num total, num size) {
    final full = (total / size + 1e-9).floor();
    final rest = ((total - full * size) * 100).round() / 100;
    return [
      for (var i = 0; i < full; i++) {'length': size},
      if (rest > 0) {'length': rest},
    ];
  }

  /// 40 -> "40", 2.5 -> "2.5".
  static String _fmt(num v) {
    final r = (v * 100).round() / 100;
    return r == r.roundToDouble() ? '${r.toInt()}' : '$r';
  }

  void _applyTemplate(String name) {
    final t = kSparepartTemplates.values.expand((g) => g).firstWhere((t) => t.name == name);
    setState(() {
      _mode = t.mode;
      _unit.text = t.unit;
      _packUnit.text = t.packUnit;
      _packSize.text = t.packSize;
      if (_name.text.trim().isEmpty) _name.text = t.name;
      if (_category.text.trim().isEmpty) _category.text = t.category;
    });
  }

  /// Isian satuan bebas + tombol pilihan cepat di bawahnya.
  Widget _unitField(String keyName, String label, TextEditingController c, List<String> options,
          String hint, String emptyMessage) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppTextField(
            key: Key(keyName),
            label: label,
            required: true,
            hint: hint,
            controller: c,
            enabled: !_busy,
            onChanged: (_) => setState(() {}),
            validator: (v) => (v ?? '').trim().isEmpty ? emptyMessage : null,
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final o in options)
              AppFilterChip(
                key: Key('$keyName-$o'),
                label: o,
                selected: c.text.trim() == o,
                onTap: () => setState(() => c.text = o),
              ),
          ]),
        ],
      );

  /// "4 tabung = 40 kg" / "25 kg ≈ 2 tabung + 5 kg (dicatat ...)", sama dengan web.
  String? get _equivalent {
    final qty = _initialStock;
    final size = _packSizeValue;
    if (qty <= 0 || size <= 0) return null;
    final base = ((_inPack ? qty * size : qty) * 100).round() / 100;
    final full = (base / size + 1e-9).floor();
    final rest = ((base - full * size) * 100).round() / 100;
    final text = _inPack
        ? '${_fmt(qty)} $_big = ${_fmt(base)} $_small'
        : '${_fmt(base)} $_small ≈ ${[
            if (full > 0) '$full $_big',
            if (rest > 0 || full == 0) '${_fmt(rest)} $_small',
          ].join(' + ')}';
    if (_mode != 'gabungan' || rest <= 0) return text;
    return '$text (dicatat ${full > 0 ? '$full $_big penuh + ' : ''}1 $_big terbuka ${_fmt(rest)} $_small)';
  }

  Widget _modeCard((String, String, String) m) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Material(
          color: _mode == m.$1 ? Theme.of(context).colorScheme.primaryContainer : Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: Theme.of(context).dividerColor),
          ),
          child: ListTile(
            key: Key('mode-${m.$1}'),
            selected: _mode == m.$1,
            title: Text(m.$2),
            subtitle: Text(m.$3),
            trailing: _mode == m.$1 ? const Icon(Icons.check_circle) : null,
            onTap: _busy ? null : () => setState(() => _mode = m.$1),
          ),
        ),
      );

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
              hint: 'Contoh: Pipa AC 1/4 inch',
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
                    key: const Key('sku'),
                    label: 'SKU',
                    hint: 'Opsional',
                    controller: _sku,
                    enabled: !_busy,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppTextField(
                    key: const Key('category'),
                    label: 'Kategori',
                    hint: 'Opsional',
                    controller: _category,
                    enabled: !_busy,
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            if (_isEdit)
              _unitField('unit', 'Satuannya apa?', _unit, _smallUnits, 'pcs, kg, meter, set',
                  'Wajib diisi (mis. pcs, kg, meter)')
            else
              AppSelectField<String>(
                key: const Key('template'),
                label: 'Template cepat',
                hint: 'Pilih jenis sparepart AC',
                helper: 'Mengisi otomatis jenis & satuan. Isi kemasan hanya contoh, sesuaikan.',
                enabled: !_busy,
                items: [
                  for (final g in kSparepartTemplates.entries) ...[
                    DropdownMenuItem(
                      value: '#${g.key}',
                      enabled: false,
                      child: Text(g.key,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                          overflow: TextOverflow.ellipsis),
                    ),
                    for (final t in g.value)
                      DropdownMenuItem(
                        value: t.name,
                        child: Text(t.name, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                ],
                onChanged: (v) {
                  if (v != null) _applyTemplate(v);
                },
              ),
          ],
        ),
        if (!_isEdit) ...[
          const SizedBox(height: AppSpacing.grid),
          AppFormCard(
            title: 'Barang ini dijual bagaimana?',
            children: [
              for (final m in _modes) _modeCard(m),
              const SizedBox(height: kFieldGap),
              if (_packMode) ...[
                Text('1 $_big berisi ${_packSize.text.isEmpty ? '…' : _packSize.text} $_small',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                _unitField('packUnit', 'Wadahnya', _packUnit, _packUnits, 'tabung, roll, dus',
                    'Wajib diisi (mis. roll, tabung, dus)'),
                const SizedBox(height: kFieldGap),
                AppNumberField(
                  key: const Key('packSize'),
                  label: 'Isinya berapa?',
                  required: true,
                  decimal: true,
                  hint: '10',
                  controller: _packSize,
                  enabled: !_busy,
                  onChanged: (_) => setState(() {}),
                  validator: (_) => _packSizeValue > 0 ? null : 'Isi harus lebih dari 0',
                ),
                const SizedBox(height: kFieldGap),
                _unitField('unit', 'Satuan isinya', _unit, _smallUnits, 'kg, meter, pcs',
                    'Wajib diisi (mis. pcs, kg, meter)'),
              ] else
                _unitField('unit', 'Satuannya apa?', _unit, _smallUnits, 'pcs, kg, meter, set',
                    'Wajib diisi (mis. pcs, kg, meter)'),
            ],
          ),
        ],
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Harga & Stok',
          subtitle: _isGudang
              ? 'Harga boleh dikosongkan: barang disimpan dulu, admin yang mengisi harganya.'
              : 'Stok di bawah stok minimum muncul di peringatan dashboard.',
          children: [
            AppMoneyField(
              key: const Key('sellPrice'),
              label: _packMode ? 'Harga jual per $_small' : 'Harga jual',
              required: !_isGudang,
              controller: _sellPrice,
              enabled: !_busy,
              validator: _isGudang ? null : rupiahRequiredValidator,
            ),
            if (_packMode) ...[
              const SizedBox(height: kFieldGap),
              AppMoneyField(
                key: const Key('sellPricePack'),
                label: 'Harga jual 1 $_big utuh',
                required: !_isGudang,
                controller: _sellPricePack,
                enabled: !_busy,
                validator: _isGudang ? null : rupiahRequiredValidator,
              ),
            ],
            const SizedBox(height: kFieldGap),
            if (_isEdit)
              const Text('Stok dan harga modal diatur lewat Stok Masuk.')
            else if (_mode == 'gulungan')
              const Text('Stok awalnya diisi sesudah barang ini disimpan, lewat Terima Barang '
                  '(satu per satu panjang tiap gulungan).')
            else ...[
              if (_packMode) ...[
                const Text('Stok yang ada sekarang, mau dihitung per apa?'),
                const SizedBox(height: 8),
                Row(children: [
                  AppFilterChip(
                    key: const Key('stockIn-pack'),
                    label: _big,
                    selected: _inPack,
                    onTap: () => setState(() => _inPack = true),
                  ),
                  const SizedBox(width: 8),
                  AppFilterChip(
                    key: const Key('stockIn-unit'),
                    label: _small,
                    selected: !_inPack,
                    onTap: () => setState(() => _inPack = false),
                  ),
                ]),
                const SizedBox(height: kFieldGap),
              ],
              AppNumberField(
                key: const Key('stock'),
                label: _packMode
                    ? 'Berapa ${_inPack ? _big : _small}?'
                    : 'Stok yang ada sekarang ($_small)',
                decimal: true,
                hint: '0',
                controller: _stock,
                enabled: !_busy,
                onChanged: (_) => setState(() {}),
                validator: (v) => (v ?? '').trim().isEmpty ||
                        num.tryParse(v!.trim().replaceAll(',', '.')) != null
                    ? null
                    : 'Harus berupa angka',
              ),
              if (_packMode && _equivalent != null) ...[
                const SizedBox(height: 6),
                Text(_equivalent!,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, color: AppColors.tealDeep)),
              ],
              if (!_isGudang) ...[
                const SizedBox(height: kFieldGap),
                AppMoneyField(
                  key: const Key('buyPrice'),
                  label: _packMode ? 'Harga Modal per ${_inPack ? _big : _small}' : 'Harga Modal',
                  helper: 'Wajib bila ada stok awal',
                  controller: _buyPrice,
                  enabled: !_busy,
                  onChanged: (_) => setState(() {}),
                  validator: (v) => _initialStock > 0 ? rupiahRequiredValidator(v) : null,
                ),
                if (_packMode &&
                    _inPack &&
                    _packSizeValue > 0 &&
                    parseRupiahInput(_buyPrice.text) > 0) ...[
                  const SizedBox(height: 6),
                  Text(
                      '= ${formatRupiahNum(parseRupiahInput(_buyPrice.text) / _packSizeValue)} per $_small'),
                ],
              ],
            ],
            const SizedBox(height: kFieldGap),
            if (!_isGudang) ...[
              AppNumberField(
                key: const Key('minStock'),
                label: 'Stok Minimum',
                decimal: true,
                hint: '0',
                suffixText: _small,
                controller: _minStock,
                enabled: !_busy,
              ),
              const SizedBox(height: kFieldGap),
            ],
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
