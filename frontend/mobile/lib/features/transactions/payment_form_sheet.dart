import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/invoice.dart';
import '../pos/cart_state.dart' show formatRupiah;
import 'invoice_providers.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/notice_panel.dart';
import '../../core/theme/app_motion.dart';

/// Membuka bottom sheet pencatatan pembayaran manual untuk [invoice].
Future<void> showPaymentFormSheet(BuildContext context, Invoice invoice) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
    ),
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(sheetContext).viewInsets.bottom,
      ),
      child: PaymentFormSheet(invoice: invoice),
    ),
  );
}

/// Form pencatatan pembayaran manual. Aturan nominal:
/// - **tunai**: uang diterima boleh melebihi sisa; kembalian ditampilkan dan
///   yang dikirim ke server = `min(input, sisa)` (nominal pas).
/// - **non-tunai**: input tidak boleh melebihi sisa (validator menolak).
class PaymentFormSheet extends ConsumerStatefulWidget {
  const PaymentFormSheet({super.key, required this.invoice});

  final Invoice invoice;

  @override
  ConsumerState<PaymentFormSheet> createState() => _PaymentFormSheetState();
}

class _PaymentFormSheetState extends ConsumerState<PaymentFormSheet> {
  final _formKey = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  PaymentMethod _method = PaymentMethod.tunai;
  bool _busy = false;

  int get _sisa => widget.invoice.sisa;

  // Kolomnya `AppMoneyField`, jadi teksnya sudah berpemisah titik —
  // `int.tryParse` akan gagal membacanya.
  int? get _amountInput =>
      _amount.text.trim().isEmpty ? null : parseRupiahInput(_amount.text);

  int get _change {
    final input = _amountInput ?? 0;
    return input > _sisa ? input - _sisa : 0;
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  String? _amountValidator(String? v) {
    final n = parseRupiahInput(v ?? '');
    if (n <= 0) return 'Nominal harus lebih dari 0';
    if (_method != PaymentMethod.tunai && n > _sisa) {
      return 'Melebihi sisa tagihan';
    }
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final input = _amountInput ?? 0;
    // Tunai: catat nominal pas (kembalian dihitung di client). Non-tunai
    // sudah dijaga validator agar <= sisa.
    final amount = _method == PaymentMethod.tunai && input > _sisa
        ? _sisa
        : input;
    final payload = <String, dynamic>{
      'invoiceId': widget.invoice.id,
      'method': _method.value,
      'amount': amount,
    };
    final note = _note.text.trim();
    if (note.isNotEmpty) payload['note'] = note;

    final caller = ref.read(recordPaymentCallerProvider);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await caller(payload);
      if (!mounted) return;
      navigator.pop();
      messenger.showSnackBar(
        const SnackBar(content: Text('Pembayaran tercatat.')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(
        SnackBar(
          content: Text('Gagal mencatat pembayaran: ${errorMessage(e)}'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        // Pesan validasi hilang begitu field diperbaiki, tidak
        // menunggu tombol submit ditekan lagi.
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: AppColors.slate300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const Text(
              'Catat Pembayaran',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: AppColors.slate900,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: AppColors.teal50,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Sisa tagihan',
                      style: TextStyle(color: AppColors.slate600)),
                  Text(
                    formatRupiah(_sisa),
                    style: const TextStyle(
                      color: AppColors.teal700,
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            AppSelectField<PaymentMethod>(
              key: const Key('method'),
              label: 'Metode',
              required: true,
              value: _method,
              enabled: !_busy,
              items: [
                for (final m in PaymentMethod.values)
                  DropdownMenuItem(value: m, child: Text(m.label)),
              ],
              onChanged: (v) => setState(() => _method = v ?? _method),
            ),
            const SizedBox(height: kFieldGap),
            AppMoneyField(
              key: const Key('amount'),
              label: _method == PaymentMethod.tunai
                  ? 'Uang Diterima'
                  : 'Nominal',
              required: true,
              controller: _amount,
              enabled: !_busy,
              validator: _amountValidator,
              onChanged: (_) => setState(() {}),
            ),
            // Kembalian muncul memudar begitu nominalnya melebihi sisa
            // tagihan, jadi kasir melihatnya berubah sambil mengetik.
            AppSwap(
              alignment: Alignment.topLeft,
              switchKey: _method == PaymentMethod.tunai && _change > 0
                  ? _change
                  : 0,
              child: _method == PaymentMethod.tunai && _change > 0
                  ? Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: NoticePanel(
                        key: const Key('change'),
                        tone: NoticeTone.success,
                        icon: Icons.payments_outlined,
                        text: 'Kembalian: ${formatRupiah(_change)}',
                      ),
                    )
                  : const SizedBox(width: double.infinity),
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('note'),
              label: 'Catatan',
              hint: 'Mis. transfer via BCA a.n. Budi',
              controller: _note,
              enabled: !_busy,
            ),
            const SizedBox(height: 24),
            SizedBox(
              height: 50,
              child: FilledButton(
                key: const Key('pay-submit'),
                onPressed: _busy ? null : _submit,
                child: AppSwap(
                  alignment: Alignment.center,
                  switchKey: _busy,
                  child: _busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Simpan Pembayaran'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
