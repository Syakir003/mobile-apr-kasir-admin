import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';

/// Alasan mutasi stok yang boleh dipilih manual. Sengaja TIDAK memuat
/// 'penjualan' & 'pemakaian' — keduanya milik sistem (checkout & pemakaian
/// material job) dan ditolak oleh RPC `adjust_stock`.
const manualStockReasons = <String, String>{
  'pembelian': 'Pembelian / Barang Masuk',
  'koreksi': 'Koreksi Stok Opname',
  'retur': 'Retur',
  'rusak': 'Rusak / Hilang',
};

class StockRow {
  const StockRow({
    required this.id,
    required this.kind,
    required this.name,
    required this.stock,
    this.min,
  });

  final String id;

  /// 'product' | 'sparepart' — dikirim apa adanya sebagai `itemKind` ke RPC.
  final String kind;
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

/// Ringkasan stok (produk + sparepart) & mutasi terakhir. Pengurangan otomatis
/// terjadi via RPC checkout / pemakaian material; mutasi manual lewat
/// [adjustStockCallerProvider].
final stockOverviewProvider =
    FutureProvider.autoDispose<StockOverview>((ref) async {
  final client = ref.watch(supabaseProvider);

  final productRows = await client
      .from('products')
      .select('id,name,stock')
      .eq('active', true)
      .order('stock', ascending: true)
      .limit(500);
  final sparepartRows = await client
      .from('spareparts')
      .select('id,name,stock,min_stock')
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
        StockRow(
          id: '${r['id']}',
          kind: 'product',
          name: '${r['name']}',
          stock: (r['stock'] as num?) ?? 0,
        ),
    ],
    spareparts: [
      for (final r in (sparepartRows as List))
        StockRow(
          id: '${r['id']}',
          kind: 'sparepart',
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

/// RPC `adjust_stock` — barang masuk / penyesuaian manual (admin).
/// Dipisah sebagai provider agar mudah di-override fake di test.
final adjustStockCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('adjust_stock', params: {'payload': payload});
  };
});
