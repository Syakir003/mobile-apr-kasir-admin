import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import 'cart_state.dart';
import 'pos_providers.dart';

/// Form checkout: data pelanggan + diskon/pajak/transport + catatan, lalu
/// panggil `checkoutTransaction`. Pola sama seperti
/// `member_form_screen.dart`/`unit_form_screen.dart` (Form + busy-guard +
/// SnackBar + `context.go`).
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _address;
  late final TextEditingController _discount;
  late final TextEditingController _taxPercent;
  late final TextEditingController _transportFee;
  late final TextEditingController _notes;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final cart = ref.read(cartProvider);
    _name = TextEditingController(text: cart.customerName);
    _phone = TextEditingController(text: cart.customerPhone);
    _address = TextEditingController(text: cart.customerAddress);
    _discount = TextEditingController(text: cart.discount.toString());
    _taxPercent = TextEditingController(text: _trimZero(cart.taxPercent));
    _transportFee = TextEditingController(text: cart.transportFee.toString());
    _notes = TextEditingController(text: cart.notes);
  }

  static String _trimZero(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _address.dispose();
    _discount.dispose();
    _taxPercent.dispose();
    _transportFee.dispose();
    _notes.dispose();
    super.dispose();
  }

  String? _requiredValidator(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null;

  String? _nonNegativeIntValidator(String? v) {
    if (v == null || v.trim().isEmpty) return null;
    final n = int.tryParse(v.trim());
    if (n == null || n < 0) return 'Angka tidak valid';
    return null;
  }

  String? _taxPercentValidator(String? v) {
    if (v == null || v.trim().isEmpty) return null;
    final n = double.tryParse(v.trim());
    if (n == null || n < 0 || n > 100) return 'Harus 0-100';
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final notifier = ref.read(cartProvider.notifier);
    notifier.setCustomer(
      name: _name.text.trim(),
      phone: _phone.text.trim(),
      address: _address.text.trim(),
    );
    notifier.setDiscount(int.tryParse(_discount.text.trim()) ?? 0);
    notifier.setTaxPercent(double.tryParse(_taxPercent.text.trim()) ?? 0);
    notifier.setTransportFee(int.tryParse(_transportFee.text.trim()) ?? 0);
    notifier.setNotes(_notes.text.trim());

    final payload = buildCheckoutPayload(ref.read(cartProvider));
    final caller = ref.read(checkoutCallerProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final result = await caller(payload);
      // Keranjang HANYA dikosongkan setelah checkout benar-benar sukses.
      notifier.clear();
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('Transaksi dibuat: ${result.invoiceNumber}')),
      );
      context.go('/transactions/${result.invoiceId}');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(
        SnackBar(
          content: Text('Gagal checkout: $e'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = ref.watch(cartProvider);
    final discount = int.tryParse(_discount.text.trim()) ?? cart.discount;
    final taxPercent =
        double.tryParse(_taxPercent.text.trim()) ?? cart.taxPercent;
    final transportFee =
        int.tryParse(_transportFee.text.trim()) ?? cart.transportFee;
    final previewCart = cart.copyWith(
      discount: discount,
      taxPercent: taxPercent,
      transportFee: transportFee,
    );
    final totals = computeCartTotals(previewCart);

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              key: const Key('name'),
              controller: _name,
              decoration: const InputDecoration(labelText: 'Nama Pelanggan'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('phone'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Nomor HP',
                helperText: 'Disimpan dalam format +628xxxxxxxx',
              ),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('address'),
              controller: _address,
              maxLines: 2,
              decoration:
                  const InputDecoration(labelText: 'Alamat (opsional)'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('discount'),
              controller: _discount,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Diskon (Rp)'),
              validator: _nonNegativeIntValidator,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('taxPercent'),
              controller: _taxPercent,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Pajak (%)'),
              validator: _taxPercentValidator,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('transportFee'),
              controller: _transportFee,
              keyboardType: TextInputType.number,
              decoration:
                  const InputDecoration(labelText: 'Ongkos Transport (Rp)'),
              validator: _nonNegativeIntValidator,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('notes'),
              controller: _notes,
              maxLines: 3,
              decoration:
                  const InputDecoration(labelText: 'Catatan (opsional)'),
            ),
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _summaryRow('Subtotal', formatRupiah(totals.subtotal)),
                    _summaryRow('Diskon', '- ${formatRupiah(discount)}'),
                    _summaryRow('Pajak', formatRupiah(totals.taxAmount)),
                    _summaryRow('Transport', formatRupiah(transportFee)),
                    const Divider(),
                    _summaryRow(
                      'Total',
                      formatRupiah(totals.grandTotal),
                      bold: true,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            FilledButton(
              key: const Key('submit'),
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Buat Transaksi'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryRow(String label, String value, {bool bold = false}) {
    final style = bold ? const TextStyle(fontWeight: FontWeight.bold) : null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [Text(label, style: style), Text(value, style: style)],
      ),
    );
  }
}
