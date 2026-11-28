import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import 'stock_providers.dart';

// Opname produk AC (padanan web): ketik jumlah unit yang benar. Kalau lebih sedikit dari catatan, server menandai
// unit yang paling baru masuk sebagai dihapus dan mengembalikan kodenya supaya labelnya dicabut. Menambah unit
// lewat Terima Barang karena butuh QR.

/// Unit yang sudah dipesan invoice: masih di rak, tetapi tidak termasuk stok tersedia.
final productReservedProvider = FutureProvider.autoDispose.family<int, String>((ref, id) async {
  final rows = await const ApiClient().get('/products/$id/units?status=reserved') as List;
  return rows.length;
});

/// `POST /stock/opname` produk; hasilnya kode unit yang dihapus.
final productOpnameCallerProvider = Provider<Future<List<String>> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final r = await const ApiClient().post('/stock/opname', body: payload);
    ref.invalidate(stockOverviewProvider);
    final first = r is List && r.isNotEmpty ? r.first : null;
    final removed = first is Map ? first['removedUnits'] : null;
    return [for (final code in (removed as List? ?? const [])) '$code'];
  };
});

class ProductOpnameForm extends ConsumerStatefulWidget {
  const ProductOpnameForm({super.key, required this.products, this.initialId});

  final List<StockRow> products;
  final String? initialId;

  @override
  ConsumerState<ProductOpnameForm> createState() => _ProductOpnameFormState();
}

class _ProductOpnameFormState extends ConsumerState<ProductOpnameForm> {
  late String? _id = widget.initialId;
  final _qty = TextEditingController();
  bool _busy = false;

  /// Hasil terakhir, supaya daftar labelnya tidak hilang begitu saja.
  List<String> _removed = const [];

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  Future<void> _submit(StockRow item, int physical) async {
    final system = item.stock.toInt();
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kurangi stok AC?'),
        content: Text('${item.name}: stok dari $system menjadi $physical unit. '
            '${system - physical} unit yang paling baru masuk dihapus.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Ya, kurangi')),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final removed = await ref.read(productOpnameCallerProvider)({
        'items': [
          {'kind': 'product', 'refId': item.id, 'physicalQty': physical},
        ],
      });
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(content: Text('Stok dikoreksi.')));
      setState(() {
        _removed = removed;
        _qty.clear();
      });
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.products.where((p) => p.id == _id).firstOrNull;
    final system = item?.stock.toInt() ?? 0;
    final physical = int.tryParse(_qty.text.trim());
    final reserved = item == null ? 0 : ref.watch(productReservedProvider(item.id)).valueOrNull ?? 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownButtonFormField<String>(
          key: const Key('opname-product'),
          initialValue: item?.id,
          isExpanded: true,
          decoration: const InputDecoration(hintText: 'Pilih produk AC'),
          items: [
            for (final p in widget.products)
              DropdownMenuItem(
                value: p.id,
                child: Text('${p.name} · stok ${p.stock.toInt()}', maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
          ],
          onChanged: _busy
              ? null
              : (v) => setState(() {
                    _id = v;
                    _removed = const [];
                    _qty.clear();
                  }),
        ),
        if (item != null) ...[
          const SizedBox(height: 16),
          Text('Tercatat tersedia: $system unit', style: const TextStyle(fontWeight: FontWeight.w700)),
          if (reserved > 0)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('$reserved unit sudah dipesan invoice. Jangan ikut dihitung.',
                  style: const TextStyle(color: AppColors.danger)),
            ),
          const SizedBox(height: 12),
          const Text('Jumlah yang benar (unit)', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          TextField(
            key: const Key('opname-qty'),
            controller: _qty,
            enabled: !_busy,
            onChanged: (_) => setState(() {}),
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          ),
          if (physical != null && physical > system)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Lebih banyak dari catatan. Masukkan unit tambahan lewat Terima Barang supaya dapat QR.',
                  style: TextStyle(color: AppColors.danger)),
            ),
          if (physical != null && physical < system)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('${system - physical} unit yang paling baru masuk akan dihapus.'),
            ),
          const SizedBox(height: 16),
          SizedBox(
            height: 52,
            child: FilledButton.icon(
              key: const Key('opname-product-submit'),
              onPressed: !_busy && physical != null && physical < system ? () => _submit(item, physical) : null,
              icon: const Icon(Icons.fact_check_outlined),
              label: Text(_busy ? 'Menyimpan...' : 'Koreksi stok'),
            ),
          ),
        ],
        if (_removed.isNotEmpty) ...[
          const SizedBox(height: 16),
          const Text('Cabut label unit berikut:', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          SelectableText(_removed.join('\n')),
        ],
      ],
    );
  }
}
