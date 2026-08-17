import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/form_scaffold.dart';
import '../../data/models/member.dart';
import '../../data/models/voucher.dart';
import '../pos/member_picker_sheet.dart';
import 'voucher_providers.dart';

/// Form buat voucher ad-hoc (admin): pilih pelanggan, tipe+nilai diskon,
/// syarat opsional (cap, min pembelian), tanggal kedaluwarsa, catatan. WA
/// berisi kode langsung antre di `wa_outbox` — pengirimannya lewat layar
/// Pengingat yang sudah ada, bukan di sini.
class VoucherFormScreen extends ConsumerStatefulWidget {
  const VoucherFormScreen({super.key});

  @override
  ConsumerState<VoucherFormScreen> createState() => _VoucherFormScreenState();
}

class _VoucherFormScreenState extends ConsumerState<VoucherFormScreen> {
  final _formKey = GlobalKey<FormState>();
  Member? _member;
  VoucherDiscountType _type = VoucherDiscountType.nominal;
  final _value = TextEditingController();
  final _cap = TextEditingController();
  final _minPurchase = TextEditingController();
  final _note = TextEditingController();
  DateTime? _expiresAt;
  bool _busy = false;

  @override
  void dispose() {
    _value.dispose();
    _cap.dispose();
    _minPurchase.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickMember() async {
    final picked = await showModalBottomSheet<Member>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const MemberPickerSheet(),
    );
    if (picked != null && mounted) setState(() => _member = picked);
  }

  Future<void> _pickExpiry() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _expiresAt ?? now.add(const Duration(days: 30)),
      firstDate: now,
      lastDate: DateTime(now.year + 2),
    );
    if (picked != null) setState(() => _expiresAt = picked);
  }

  String? _requiredNumber(String? v) {
    final n = int.tryParse((v ?? '').trim());
    if (n == null || n <= 0) return 'Wajib diisi, harus lebih dari 0';
    if (_type == VoucherDiscountType.persen && n > 100) return 'Maksimal 100';
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_member == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Pilih pelanggan dulu')));
      return;
    }
    if (_expiresAt == null) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Pilih tanggal kedaluwarsa')));
      return;
    }
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final code = await ref.read(createVoucherCallerProvider)({
        'memberId': _member!.id,
        'discountType': _type.value,
        'discountValue': int.parse(_value.text.trim()),
        if (_type == VoucherDiscountType.persen && _cap.text.trim().isNotEmpty)
          'maxDiscountCap': int.parse(_cap.text.trim()),
        if (_minPurchase.text.trim().isNotEmpty)
          'minPurchase': int.parse(_minPurchase.text.trim()),
        'expiresAt': _expiresAt!.toIso8601String().split('T').first,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text('Voucher dibuat: $code')));
      context.go('/voucher');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(SnackBar(
        content: Text('Gagal membuat voucher: ${errorMessage(e)}'),
        backgroundColor: AppColors.danger,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppFormScaffold(
      title: 'Buat Voucher',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Buat Voucher',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        AppFormCard(
          title: 'Pelanggan',
          children: [
            OutlinedButton.icon(
              key: const Key('pilih-member'),
              onPressed: _busy ? null : _pickMember,
              icon: const Icon(Icons.person_outline),
              label: Text(_member == null ? 'Pilih pelanggan' : _member!.name),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Diskon',
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
              validator: _requiredNumber,
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
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Syarat & Ketentuan',
          children: [
            OutlinedButton.icon(
              key: const Key('pilih-expiry'),
              onPressed: _busy ? null : _pickExpiry,
              icon: const Icon(Icons.event_outlined),
              label: Text(_expiresAt == null
                  ? 'Pilih tanggal kedaluwarsa'
                  : 'Berlaku sampai ${formatTanggalPanjang(_expiresAt!)}'),
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('note'),
              label: 'Catatan (opsional)',
              hint: 'Alasan pemberian / syarat tambahan',
              maxLines: 3,
              controller: _note,
              enabled: !_busy,
            ),
          ],
        ),
      ],
    );
  }
}
