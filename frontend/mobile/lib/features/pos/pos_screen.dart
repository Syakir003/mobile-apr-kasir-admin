import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import 'cart_state.dart';
import 'item_picker_sheet.dart';
import 'pos_providers.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/form_field.dart';

/// Layar keranjang POS: daftar baris item, ringkasan total, dan tombol
/// lanjut ke checkout (`/pos/checkout`).
class PosScreen extends ConsumerWidget {
  const PosScreen({super.key});

  void _openPicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const ItemPickerSheet(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cart = ref.watch(cartProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Transaksi')),
      floatingActionButton: cart.lines.isEmpty
          ? null
          : FloatingActionButton.extended(
              key: const Key('add-item'),
              onPressed: () => _openPicker(context),
              icon: const Icon(Icons.add_shopping_cart),
              label: const Text('Tambah Item'),
            ),
      body: Column(
        children: [
          Expanded(
            child: cart.lines.isEmpty
                ? _EmptyCart(onAdd: () => _openPicker(context))
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                    itemCount: cart.lines.length,
                    itemBuilder: (_, i) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _CartLineTile(
                        key: ValueKey(
                          '${cart.lines[i].kind.name}-${cart.lines[i].refId}',
                        ),
                        index: i,
                      ),
                    ),
                  ),
          ),
          if (cart.lines.isNotEmpty) _CheckoutBar(cart: cart),
        ],
      ),
    );
  }
}

class _EmptyCart extends StatelessWidget {
  const _EmptyCart({required this.onAdd});
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.shopping_cart_outlined,
              size: 56, color: AppColors.slate300),
          const SizedBox(height: 14),
          const Text('Keranjang masih kosong.',
              style: TextStyle(color: AppColors.slate500)),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const Key('add-item'),
            onPressed: onAdd,
            icon: const Icon(Icons.add_shopping_cart),
            label: const Text('Tambah Item'),
          ),
        ],
      ),
    );
  }
}

/// Footer ringkasan + checkout menempel di bawah.
class _CheckoutBar extends StatelessWidget {
  const _CheckoutBar({required this.cart});
  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final totals = computeCartTotals(cart);
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.slate200)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      child: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _row('Subtotal', formatRupiah(totals.subtotal)),
            _row('Diskon', '- ${formatRupiah(cart.discount)}'),
            _row('Pajak', formatRupiah(totals.taxAmount)),
            _row('Transport', formatRupiah(cart.transportFee)),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Divider(height: 1),
            ),
            _row('Total', formatRupiah(totals.grandTotal), total: true),
            const SizedBox(height: 14),
            SizedBox(
              height: 50,
              child: FilledButton(
                key: const Key('to-checkout'),
                onPressed: () => context.go('/pos/checkout'),
                child: const Text('Checkout'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, {bool total = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              color: total ? AppColors.slate900 : AppColors.slate500,
              fontWeight: total ? FontWeight.bold : FontWeight.w500,
              fontSize: total ? 16 : 14,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: total ? AppColors.teal700 : AppColors.slate900,
              fontWeight: total ? FontWeight.bold : FontWeight.w600,
              fontSize: total ? 17 : 14,
            ),
          ),
        ],
      ),
    );
  }
}

class _CartLineTile extends ConsumerStatefulWidget {
  const _CartLineTile({super.key, required this.index});

  final int index;

  @override
  ConsumerState<_CartLineTile> createState() => _CartLineTileState();
}

class _CartLineTileState extends ConsumerState<_CartLineTile> {
  late final TextEditingController _room;

  @override
  void initState() {
    super.initState();
    final cart = ref.read(cartProvider);
    final line = cart.lines[widget.index];
    _room = TextEditingController(text: line.roomLocation);
  }

  @override
  void dispose() {
    _room.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cart = ref.watch(cartProvider);
    if (widget.index >= cart.lines.length) return const SizedBox.shrink();
    final line = cart.lines[widget.index];
    final notifier = ref.read(cartProvider.notifier);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        line.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                          color: AppColors.slate900,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${formatRupiah(line.unitPrice)} / ${line.unit}',
                        style: const TextStyle(
                            fontSize: 12.5, color: AppColors.slate500),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  key: Key('remove-${widget.index}'),
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.delete_outline,
                      color: AppColors.danger),
                  onPressed: () => notifier.removeAt(widget.index),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  decoration: BoxDecoration(
                    color: AppColors.slate100,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                  child: Row(
                    children: [
                      IconButton(
                        key: Key('qty-minus-${widget.index}'),
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.remove, size: 18),
                        color: AppColors.slate600,
                        onPressed: line.qty > 1
                            ? () => notifier.setQty(widget.index, line.qty - 1)
                            : null,
                      ),
                      Text(
                        '${line.qty}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          color: AppColors.slate900,
                        ),
                      ),
                      IconButton(
                        key: Key('qty-plus-${widget.index}'),
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.add, size: 18),
                        color: AppColors.slate600,
                        onPressed: () =>
                            notifier.setQty(widget.index, line.qty + 1),
                      ),
                    ],
                  ),
                ),
                Text(
                  formatRupiah(line.lineTotal),
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                    color: AppColors.slate900,
                  ),
                ),
              ],
            ),
            if (line.kind == CartItemKind.product) ...[
              const Divider(height: 20),
              SwitchListTile(
                key: Key('install-switch-${widget.index}'),
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Pasang unit',
                    style: TextStyle(fontSize: 14)),
                value: line.withInstallation,
                onChanged: (v) =>
                    notifier.setInstallation(widget.index, enabled: v),
              ),
              if (line.withInstallation) ...[
                const SizedBox(height: 4),
                AppTextField(
                  fieldKey: Key('room-location-${widget.index}'),
                  label: 'Lokasi Ruangan',
                  hint: 'Contoh: Kamar Utama',
                  controller: _room,
                  onChanged: (v) =>
                      notifier.setInstallation(widget.index, roomLocation: v),
                ),
                const SizedBox(height: 10),
                _TechnicianDropdown(index: widget.index, line: line),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _TechnicianDropdown extends ConsumerWidget {
  const _TechnicianDropdown({required this.index, required this.line});

  final int index;
  final CartLine line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final technicians = ref.watch(techniciansProvider);
    final notifier = ref.read(cartProvider.notifier);
    return technicians.when(
      data: (list) => AppSelectField<String?>(
        fieldKey: Key('technician-$index'),
        label: 'Teknisi',
        value: line.technicianId,
        items: [
          const DropdownMenuItem<String?>(
            value: null,
            child: Text('Belum ditentukan'),
          ),
          for (final t in list)
            DropdownMenuItem<String?>(value: t.uid, child: Text(t.name)),
        ],
        onChanged: (v) => notifier.setInstallation(
          index,
          technicianId: v,
          clearTechnician: v == null,
        ),
      ),
      loading: () => const LinearProgressIndicator(),
      error: (e, _) => Text('Gagal memuat teknisi: ${errorMessage(e)}'),
    );
  }
}
