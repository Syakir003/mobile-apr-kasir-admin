import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/form_scaffold.dart';
import '../../data/models/voucher.dart' show VoucherDiscountType;
import 'undian_providers.dart';

/// Form buat undian (admin): kriteria peserta otomatis + hadiah (satu macam
/// diskon untuk semua pemenang). Peserta manual & penarikan dilakukan di
/// layar detail setelah undian ini dibuat.
class UndianFormScreen extends ConsumerStatefulWidget {
  const UndianFormScreen({super.key});

  @override
  ConsumerState<UndianFormScreen> createState() => _UndianFormScreenState();
}

class _UndianFormScreenState extends ConsumerState<UndianFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _winnerCount = TextEditingController(text: '1');
  VoucherDiscountType _type = VoucherDiscountType.nominal;
  final _value = TextEditingController();
  final _cap = TextEditingController();
  final _minPurchase = TextEditingController();
  final _validDays = TextEditingController(text: '30');
  DateTime? _dateFrom;
  DateTime? _dateTo;
  bool _mustHaveAc = false;
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _winnerCount.dispose();
    _value.dispose();
    _cap.dispose();
    _minPurchase.dispose();
    _validDays.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isFrom ? _dateFrom : _dateTo) ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (picked == null) return;
    setState(() => isFrom ? _dateFrom = picked : _dateTo = picked);
  }

  String? _requiredPositiveInt(String? v) {
    final n = int.tryParse((v ?? '').trim());
    return (n == null || n <= 0) ? 'Wajib diisi, lebih dari 0' : null;
  }

  String? _discountValueValidator(String? v) {
    final err = _requiredPositiveInt(v);
    if (err != null) return err;
    final n = int.parse(v!.trim());
    if (_type == VoucherDiscountType.persen && n > 100) return 'Maksimal 100';
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final criteria = <String, dynamic>{
        if (_dateFrom != null)
          'dateFrom': _dateFrom!.toIso8601String().split('T').first,
        if (_dateTo != null) 'dateTo': _dateTo!.toIso8601String().split('T').first,
        'mustHaveAcPurchase': _mustHaveAc,
      };
      final result = await ref.read(createUndianCallerProvider)({
        'title': _title.text.trim(),
        if (_description.text.trim().isNotEmpty)
          'description': _description.text.trim(),
        'criteria': criteria,
        'winnerCount': int.parse(_winnerCount.text.trim()),
        'discountType': _type.value,
        'discountValue': int.parse(_value.text.trim()),
        if (_type == VoucherDiscountType.persen && _cap.text.trim().isNotEmpty)
          'maxDiscountCap': int.parse(_cap.text.trim()),
        if (_minPurchase.text.trim().isNotEmpty)
          'minPurchase': int.parse(_minPurchase.text.trim()),
        'voucherValidDays': int.parse(_validDays.text.trim()),
      });
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content:
            Text('Undian dibuat, ${result.participantCount} peserta terkumpul.'),
      ));
      context.go('/undian/${result.undianId}');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(SnackBar(
        content: Text('Gagal membuat undian: ${errorMessage(e)}'),
        backgroundColor: AppColors.danger,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppFormScaffold(
      title: 'Buat Undian',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Buat Undian',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        AppFormCard(
          title: 'Info Undian',
          children: [
            AppTextField(
              key: const Key('title'),
              label: 'Judul',
              required: true,
              controller: _title,
              enabled: !_busy,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('description'),
              label: 'Deskripsi (opsional)',
              maxLines: 2,
              controller: _description,
              enabled: !_busy,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('winnerCount'),
              label: 'Jumlah pemenang',
              required: true,
              controller: _winnerCount,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              validator: _requiredPositiveInt,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Kriteria Peserta Otomatis',
          subtitle: 'Kosongkan tanggal untuk mengikutkan semua member aktif. '
              'Peserta tambahan/manual bisa diatur setelah undian dibuat.',
          children: [
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _pickDate(isFrom: true),
                    icon: const Icon(Icons.event_outlined),
                    label: Text(_dateFrom == null
                        ? 'Dari tanggal'
                        : formatTanggalPanjang(_dateFrom!)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _pickDate(isFrom: false),
                    icon: const Icon(Icons.event_outlined),
                    label: Text(_dateTo == null
                        ? 'Sampai tanggal'
                        : formatTanggalPanjang(_dateTo!)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            SwitchListTile(
              key: const Key('mustHaveAc'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Harus pernah beli AC baru'),
              value: _mustHaveAc,
              onChanged: _busy ? null : (v) => setState(() => _mustHaveAc = v),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Hadiah',
          subtitle: 'Satu macam diskon untuk semua pemenang.',
          children: [
            AppSelectField<VoucherDiscountType>(
              key: const Key('discountType'),
              label: 'Tipe',
              required: true,
              value: _type,
              enabled: !_busy,
              items: const [
                DropdownMenuItem(
                    value: VoucherDiscountType.nominal,
                    child: Text('Nominal (Rp)')),
                DropdownMenuItem(
                    value: VoucherDiscountType.persen, child: Text('Persen (%)')),
              ],
              onChanged: (v) => setState(() => _type = v ?? _type),
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('discountValue'),
              label: _type == VoucherDiscountType.persen ? 'Nilai (%)' : 'Nilai (Rp)',
              required: true,
              controller: _value,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              validator: _discountValueValidator,
            ),
            if (_type == VoucherDiscountType.persen) ...[
              const SizedBox(height: kFieldGap),
              AppTextField(
                key: const Key('maxDiscountCap'),
                label: 'Maks potongan (Rp, opsional)',
                controller: _cap,
                enabled: !_busy,
                keyboardType: TextInputType.number,
              ),
            ],
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('minPurchase'),
              label: 'Minimal pembelian (Rp, opsional)',
              controller: _minPurchase,
              enabled: !_busy,
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('validDays'),
              label: 'Masa berlaku voucher pemenang (hari)',
              required: true,
              controller: _validDays,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              validator: _requiredPositiveInt,
            ),
          ],
        ),
      ],
    );
  }
}
