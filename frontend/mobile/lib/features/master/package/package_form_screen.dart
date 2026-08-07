import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_motion.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/currency.dart';
import '../../../core/utils/error_message.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/form_field.dart';
import '../../../core/widgets/form_scaffold.dart';
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
          content: Text('Gagal menyimpan: ${errorMessage(e)}'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final sparepartsAsync = ref.watch(sparepartListProvider);
    final spareparts = sparepartsAsync.value ?? const <Sparepart>[];
    return AppFormScaffold(
      title: _isEdit ? 'Edit Paket' : 'Tambah Paket',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Simpan',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        AppFormCard(
          title: 'Detail Paket',
          children: [
            AppTextField(
              key: const Key('name'),
              label: 'Nama Paket',
              required: true,
              hint: 'Contoh: Paket Servis Rutin',
              controller: _name,
              enabled: !_busy,
              validator: _requiredValidator,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('description'),
              label: 'Deskripsi',
              hint: 'Apa saja yang termasuk dalam paket ini...',
              maxLines: 3,
              controller: _description,
              enabled: !_busy,
            ),
            const SizedBox(height: kFieldGap),
            AppSwitchTile(
              key: const Key('active'),
              title: 'Paket Aktif',
              subtitle: 'Tampil di pilihan kasir dan teknisi.',
              value: _active,
              onChanged: _busy ? null : (v) => setState(() => _active = v),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Item Paket',
          subtitle: 'Sparepart yang otomatis ikut saat paket ini dipilih.',
          children: [
            if (_items.isEmpty)
              const AppEmptyState(
                icon: Icons.inventory_2_outlined,
                title: 'Belum ada item',
                message: 'Paket masih boleh disimpan tanpa item.',
                compact: true,
              )
            else
              for (var i = 0; i < _items.length; i++)
                AppRevealIn.at(
                  i,
                  rise: 8,
                  child: Padding(
                    padding: EdgeInsets.only(top: i == 0 ? 0 : 8),
                    child: _ItemRow(
                      item: _items[i],
                      onRemove: () => _removeItem(i),
                      removeKey: Key('remove-item-$i'),
                    ),
                  ),
                ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              key: const Key('add-item'),
              onPressed: _busy ? null : () => _addItem(spareparts),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Tambah Item'),
            ),
          ],
        ),
      ],
    );
  }
}

/// Satu baris item paket di dalam kartu — kartu di dalam kartu dihindari,
/// jadi barisnya cuma permukaan Mist dengan tombol hapus di kanan.
class _ItemRow extends StatelessWidget {
  const _ItemRow({
    required this.item,
    required this.onRemove,
    required this.removeKey,
  });

  final PackageItem item;
  final VoidCallback onRemove;
  final Key removeKey;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
      decoration: BoxDecoration(
        color: AppColors.mist,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  item.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: AppFonts.display,
                    fontSize: 14,
                    height: 20 / 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textInk,
                  ),
                ),
                Text(
                  '${item.qty} ${item.unit} • ${formatRupiah(item.extraPricePerUnit)}/unit',
                  style: const TextStyle(
                    fontFamily: AppFonts.body,
                    fontSize: 12,
                    height: 16 / 12,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            key: removeKey,
            icon: const Icon(Icons.delete_outline),
            color: AppColors.danger,
            tooltip: 'Hapus item',
            onPressed: onRemove,
          ),
        ],
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
    _extraPrice =
        TextEditingController(text: formatRupiahInput(_selected.sellPrice));
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
      _extraPrice.text = formatRupiahInput(s.sellPrice);
    });
  }

  String? _numValidator(String? v) {
    if (v == null || v.trim().isEmpty) return 'Wajib diisi';
    return num.tryParse(v.trim()) == null ? 'Harus berupa angka' : null;
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop(
      PackageItem(
        sparepartId: _selected.id,
        name: _selected.name,
        qty: num.parse(_qty.text.trim()),
        unit: _selected.unit,
        extraPricePerUnit: parseRupiahInput(_extraPrice.text),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Tambah Item'),
      content: Form(
        key: _formKey,
        // Pesan validasi hilang begitu field diperbaiki, tidak
        // menunggu tombol submit ditekan lagi.
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SizedBox(
          // Dialog Material melebar mengikuti isinya; tanpa lebar tetap,
          // kolom-kolomnya menyusut sampai labelnya terpotong.
          width: 360,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppSelectField<Sparepart>(
                key: const Key('item-sparepart'),
                label: 'Sparepart',
                required: true,
                value: _selected,
                items: [
                  for (final s in widget.spareparts)
                    DropdownMenuItem(value: s, child: Text(s.name)),
                ],
                onChanged: _onSparepartChanged,
              ),
              const SizedBox(height: kFieldGap),
              AppNumberField(
                key: const Key('item-qty'),
                label: 'Qty',
                required: true,
                decimal: true,
                suffixText: _selected.unit,
                controller: _qty,
                validator: _numValidator,
              ),
              const SizedBox(height: kFieldGap),
              AppMoneyField(
                key: const Key('item-extra-price'),
                label: 'Harga Ekstra / unit',
                required: true,
                controller: _extraPrice,
                validator: rupiahRequiredValidator,
              ),
            ],
          ),
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
