import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';

class StockRow {
  const StockRow({required this.name, required this.stock, this.min});
  final String name;
  final num stock;
  final num? min;

  bool get low => min == null ? stock <= 3 : stock <= min!;
}

class MovementRow {
  const MovementRow({
    required this.name,
    required this.qtyChange,
    required this.reason,
    this.at,
  });
  final String name;
  final num qtyChange;
  final String reason;
  final DateTime? at;
}

typedef StockOverview = ({
  List<StockRow> products,
  List<StockRow> spareparts,
  List<MovementRow> movements,
});

/// Ringkasan stok (produk + sparepart) & mutasi terakhir. Read-only —
/// pengurangan stok terjadi otomatis via RPC checkout.
final stockOverviewProvider =
    FutureProvider.autoDispose<StockOverview>((ref) async {
  final client = ref.watch(supabaseProvider);

  final productRows = await client
      .from('products')
      .select('name,stock')
      .eq('active', true)
      .order('stock', ascending: true)
      .limit(500);
  final sparepartRows = await client
      .from('spareparts')
      .select('name,stock,min_stock')
      .eq('active', true)
      .order('stock', ascending: true)
      .limit(500);
  final movementRows = await client
      .from('stock_movements')
      .select('name,qty_change,reason,created_at')
      .order('created_at', ascending: false)
      .limit(100);

  return (
    products: [
      for (final r in (productRows as List))
        StockRow(name: '${r['name']}', stock: (r['stock'] as num?) ?? 0),
    ],
    spareparts: [
      for (final r in (sparepartRows as List))
        StockRow(
          name: '${r['name']}',
          stock: (r['stock'] as num?) ?? 0,
          min: (r['min_stock'] as num?) ?? 0,
        ),
    ],
    movements: [
      for (final r in (movementRows as List))
        MovementRow(
          name: '${r['name']}',
          qtyChange: (r['qty_change'] as num?) ?? 0,
          reason: '${r['reason']}',
          at: DateTime.tryParse('${r['created_at']}')?.toLocal(),
        ),
    ],
  );
});
