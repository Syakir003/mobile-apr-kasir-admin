import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/invoice.dart';
import '../pos/cart_state.dart' show formatRupiah;
import 'invoice_providers.dart';

/// Membuka bottom sheet pencatatan pembayaran manual untuk [invoice].
Future<void> showPaymentFormSheet(BuildContext context, Invoice invoice) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
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

  int? get _amountInput => int.tryParse(_amount.text.trim());

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
    final n = int.tryParse((v ?? '').trim());
    if (n == null || n <= 0) return 'Nominal harus lebih dari 0';
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
          content: Text('Gagal mencatat pembayaran: $e'),
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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Catat Pembayaran',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text('Sisa tagihan: ${formatRupiah(_sisa)}'),
            const SizedBox(height: 12),
            DropdownButtonFormField<PaymentMethod>(
              key: const Key('method'),
              initialValue: _method,
              decoration: const InputDecoration(labelText: 'Metode'),
              items: [
                for (final m in PaymentMethod.values)
                  DropdownMenuItem(value: m, child: Text(m.label)),
              ],
              onChanged: (v) => setState(() => _method = v ?? _method),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('amount'),
              controller: _amount,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: _method == PaymentMethod.tunai
                    ? 'Uang Diterima (Rp)'
                    : 'Nominal (Rp)',
              ),
              validator: _amountValidator,
              onChanged: (_) => setState(() {}),
            ),
            if (_method == PaymentMethod.tunai && _change > 0) ...[
              const SizedBox(height: 8),
              Text(
                'Kembalian: ${formatRupiah(_change)}',
                key: const Key('change'),
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            ],
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('note'),
              controller: _note,
              decoration:
                  const InputDecoration(labelText: 'Catatan (opsional)'),
            ),
            const SizedBox(height: 20),
            FilledButton(
              key: const Key('pay-submit'),
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Simpan Pembayaran'),
            ),
          ],
        ),
      ),
    );
  }
}
