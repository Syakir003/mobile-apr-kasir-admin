import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import 'cart_state.dart';
import 'item_picker_sheet.dart';
import 'pos_providers.dart';

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
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('add-item'),
        onPressed: () => _openPicker(context),
        icon: const Icon(Icons.add_shopping_cart),
        label: const Text('Tambah Item'),
      ),
      body: Column(
        children: [
          Expanded(
            child: cart.lines.isEmpty
                ? const Center(child: Text('Keranjang masih kosong.'))
                : ListView.builder(
                    padding: const EdgeInsets.all(8),
                    itemCount: cart.lines.length,
                    itemBuilder: (_, i) => _CartLineTile(
                      key: ValueKey(
                        '${cart.lines[i].kind.name}-${cart.lines[i].refId}',
                      ),
                      index: i,
                    ),
                  ),
          ),
          _SummaryCard(cart: cart),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                key: const Key('to-checkout'),
                onPressed:
                    cart.lines.isEmpty ? null : () => context.go('/pos/checkout'),
                child: const Text('Checkout'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.cart});

  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final totals = computeCartTotals(cart);
    return Card(
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _row('Subtotal', formatRupiah(totals.subtotal)),
            _row('Diskon', '- ${formatRupiah(cart.discount)}'),
            _row('Pajak', formatRupiah(totals.taxAmount)),
            _row('Transport', formatRupiah(cart.transportFee)),
            const Divider(),
            _row('Total', formatRupiah(totals.grandTotal), bold: true),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, {bool bold = false}) {
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
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        line.name,
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                      Text('${formatRupiah(line.unitPrice)} / ${line.unit}'),
                    ],
                  ),
                ),
                IconButton(
                  key: Key('remove-${widget.index}'),
                  icon: const Icon(Icons.delete_outline,
                      color: AppColors.danger),
                  onPressed: () => notifier.removeAt(widget.index),
                ),
              ],
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    IconButton(
                      key: Key('qty-minus-${widget.index}'),
                      icon: const Icon(Icons.remove_circle_outline),
                      onPressed: line.qty > 1
                          ? () => notifier.setQty(widget.index, line.qty - 1)
                          : null,
                    ),
                    Text('${line.qty}'),
                    IconButton(
                      key: Key('qty-plus-${widget.index}'),
                      icon: const Icon(Icons.add_circle_outline),
                      onPressed: () =>
                          notifier.setQty(widget.index, line.qty + 1),
                    ),
                  ],
                ),
                Text(
                  formatRupiah(line.lineTotal),
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ],
            ),
            if (line.kind == CartItemKind.product) ...[
              SwitchListTile(
                key: Key('install-switch-${widget.index}'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Pasang unit'),
                value: line.withInstallation,
                onChanged: (v) =>
                    notifier.setInstallation(widget.index, enabled: v),
              ),
              if (line.withInstallation) ...[
                TextFormField(
                  key: Key('room-location-${widget.index}'),
                  controller: _room,
                  decoration:
                      const InputDecoration(labelText: 'Lokasi Ruangan'),
                  onChanged: (v) =>
                      notifier.setInstallation(widget.index, roomLocation: v),
                ),
                const SizedBox(height: 8),
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
      data: (list) => DropdownButtonFormField<String?>(
        key: Key('technician-$index'),
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
        onChanged: (v) => notifier.setInstallation(
          index,
          technicianId: v,
          clearTechnician: v == null,
        ),
      ),
      loading: () => const LinearProgressIndicator(),
      error: (e, _) => Text('Gagal memuat teknisi: $e'),
    );
  }
}
