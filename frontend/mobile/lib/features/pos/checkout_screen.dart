import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/member.dart';
import '../members/member_providers.dart';
import 'cart_state.dart';
import 'member_picker_sheet.dart';
import 'pos_providers.dart';

/// Form checkout: data pelanggan + diskon/pajak/transport + catatan, lalu
/// panggil `checkoutTransaction`. Pola sama seperti
/// `member_form_screen.dart`/`unit_form_screen.dart` (Form + busy-guard +
/// SnackBar + `context.go`).
///
/// Pelanggan bisa dipilih dari master member (`MemberPickerSheet`) atau
/// diketik manual untuk pelanggan baru. Saat member dipilih, nama & nomor HP
/// dikunci: server mencocokkan member lewat nomor HP ternormalisasi, jadi
/// satu digit yang salah akan membuat member kembar.
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

  Future<void> _pickMember() async {
    final picked = await showModalBottomSheet<Member>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const MemberPickerSheet(),
    );
    if (picked == null || !mounted) return;
    ref.read(cartProvider.notifier).selectMember(picked);
    setState(() {
      _name.text = picked.name;
      _phone.text = picked.phone;
      _address.text = picked.address;
    });
  }

  void _clearMember() {
    ref.read(cartProvider.notifier).clearMember();
    setState(() {
      _name.clear();
      _phone.clear();
      _address.clear();
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final cart = ref.read(cartProvider);
    // Satu unit = satu job teknisi: qty jasa harus terpetakan penuh ke unit
    // member. Server juga menolak jumlah unit > qty.
    if (cart.memberId.isNotEmpty) {
      final incomplete = incompleteServiceLines(cart);
      if (incomplete.isNotEmpty) {
        final names =
            incomplete.map((i) => cart.lines[i].name).join(', ');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Pilih unit AC sesuai qty untuk: $names'),
            backgroundColor: AppColors.danger,
          ),
        );
        return;
      }
    }
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
    final memberSelected = cart.memberId.isNotEmpty;

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const _SectionLabel('Data Pelanggan'),
            _MemberPickerField(
              memberSelected: memberSelected,
              name: cart.customerName,
              phone: cart.customerPhone,
              onPick: _busy ? null : _pickMember,
              onClear: _busy ? null : _clearMember,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('name'),
              controller: _name,
              readOnly: memberSelected,
              decoration: InputDecoration(
                labelText: 'Nama Pelanggan',
                filled: memberSelected,
                helperText: memberSelected ? 'Dari data member' : null,
              ),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('phone'),
              controller: _phone,
              readOnly: memberSelected,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(
                labelText: 'Nomor HP',
                filled: memberSelected,
                helperText: memberSelected
                    ? 'Nomor member — tidak bisa diubah di sini'
                    : 'Disimpan dalam format +628xxxxxxxx',
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
            if (memberSelected && cart.lines.any(_isService)) ...[
              const SizedBox(height: 20),
              const _SectionLabel('Unit AC yang Dikerjakan'),
              _ServiceUnitsSection(memberId: cart.memberId),
            ],
            const SizedBox(height: 20),
            const _SectionLabel('Rincian Biaya'),
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
            SizedBox(
              height: 50,
              child: FilledButton(
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
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryRow(String label, String value, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              color: bold ? AppColors.slate900 : AppColors.slate500,
              fontWeight: bold ? FontWeight.bold : FontWeight.w500,
              fontSize: bold ? 16 : 14,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: bold ? AppColors.teal700 : AppColors.slate900,
              fontWeight: bold ? FontWeight.bold : FontWeight.w600,
              fontSize: bold ? 17 : 14,
            ),
          ),
        ],
      ),
    );
  }
}

bool _isService(CartLine line) => line.kind == CartItemKind.service;

/// Daftar unit AC milik member untuk tiap baris jasa: kasir menandai unit mana
/// yang dikerjakan, sebanyak qty baris (satu unit = satu job teknisi yang
/// lahir dari checkout lewat `serviceUnits`).
class _ServiceUnitsSection extends ConsumerWidget {
  const _ServiceUnitsSection({required this.memberId});

  final String memberId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final units = ref.watch(memberUnitsProvider(memberId));
    final cart = ref.watch(cartProvider);
    final notifier = ref.read(cartProvider.notifier);

    return units.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: LinearProgressIndicator(),
      ),
      error: (e, _) => Text('Gagal memuat unit AC: $e',
          style: const TextStyle(color: AppColors.danger)),
      data: (list) {
        if (list.isEmpty) {
          return const Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: EdgeInsets.all(12),
              child: Text(
                'Member ini belum punya unit AC terdaftar. Tambahkan unit '
                'lewat menu Member dulu, atau lanjutkan tanpa job teknisi.',
                style: TextStyle(color: AppColors.slate500, fontSize: 13),
              ),
            ),
          );
        }
        final children = <Widget>[];
        for (var i = 0; i < cart.lines.length; i++) {
          final line = cart.lines[i];
          if (!_isService(line)) continue;
          final target = line.qty.round();
          final picked = line.unitIds.length;
          children.add(
            Card(
              key: Key('service-units-$i'),
              margin: const EdgeInsets.only(bottom: 10),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            line.name,
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              color: AppColors.slate900,
                            ),
                          ),
                        ),
                        Text(
                          '$picked/$target unit',
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                            color: picked == target
                                ? AppColors.teal700
                                : AppColors.danger,
                          ),
                        ),
                      ],
                    ),
                    for (final u in list)
                      CheckboxListTile(
                        key: Key('unit-$i-${u.id}'),
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: line.unitIds.contains(u.id),
                        // Kunci sisanya begitu qty terpenuhi.
                        onChanged: (!line.unitIds.contains(u.id) &&
                                picked >= target)
                            ? null
                            : (_) => notifier.toggleServiceUnit(i, u.id),
                        title: Text(
                          '${u.brand} ${u.model}'.trim(),
                          style: const TextStyle(fontSize: 14),
                        ),
                        subtitle: Text(
                          [
                            if (u.roomLocation.trim().isNotEmpty)
                              u.roomLocation.trim(),
                            if (u.barcodeValue.trim().isNotEmpty)
                              u.barcodeValue.trim(),
                            u.status.label,
                          ].join(' • '),
                          style: const TextStyle(
                              fontSize: 12, color: AppColors.slate500),
                        ),
                      ),
                    _ServiceTechnicianDropdown(index: i, line: line),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            ),
          );
        }
        return Column(children: children);
      },
    );
  }
}

/// Teknisi untuk seluruh unit pada satu baris jasa (opsional — tanpa teknisi,
/// job lahir berstatus menunggu penugasan).
class _ServiceTechnicianDropdown extends ConsumerWidget {
  const _ServiceTechnicianDropdown({required this.index, required this.line});

  final int index;
  final CartLine line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final technicians = ref.watch(techniciansProvider);
    return technicians.when(
      data: (list) => DropdownButtonFormField<String?>(
        key: Key('service-technician-$index'),
        initialValue: line.technicianId,
        decoration: const InputDecoration(labelText: 'Teknisi'),
        items: [
          const DropdownMenuItem<String?>(
            value: null,
            child: Text('Belum ditentukan'),
          ),
          for (final t in list)
            DropdownMenuItem<String?>(value: t.uid, child: Text(t.name)),
        ],
        onChanged: (v) =>
            ref.read(cartProvider.notifier).setServiceTechnician(index, v),
      ),
      loading: () => const LinearProgressIndicator(),
      error: (e, _) => Text('Gagal memuat teknisi: $e'),
    );
  }
}

/// Baris pemilih member: tombol "Pilih Member" saat belum ada pilihan, atau
/// kartu ringkas member terpilih + tombol ganti/lepas.
class _MemberPickerField extends StatelessWidget {
  const _MemberPickerField({
    required this.memberSelected,
    required this.name,
    required this.phone,
    required this.onPick,
    required this.onClear,
  });

  final bool memberSelected;
  final String name;
  final String phone;
  final VoidCallback? onPick;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    if (!memberSelected) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          OutlinedButton.icon(
            key: const Key('pick-member'),
            onPressed: onPick,
            icon: const Icon(Icons.person_search),
            label: const Text('Pilih Member'),
          ),
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              'Atau isi data di bawah untuk pelanggan baru — member dibuat '
              'otomatis saat checkout.',
              style: TextStyle(fontSize: 12, color: AppColors.slate500),
            ),
          ),
        ],
      );
    }

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
        child: Row(
          children: [
            const CircleAvatar(
              radius: 18,
              backgroundColor: AppColors.slate100,
              child: Icon(Icons.person, color: AppColors.teal700, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      color: AppColors.slate900,
                    ),
                  ),
                  Text(
                    phone,
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.slate500,
                    ),
                  ),
                ],
              ),
            ),
            TextButton(
              key: const Key('change-member'),
              onPressed: onPick,
              child: const Text('Ganti'),
            ),
            IconButton(
              key: const Key('clear-member'),
              visualDensity: VisualDensity.compact,
              tooltip: 'Lepas member (pelanggan baru)',
              icon: const Icon(Icons.close, color: AppColors.slate500),
              onPressed: onClear,
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: AppColors.slate400,
        ),
      ),
    );
  }
}
