import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/utils/num_parse.dart';

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

/// [numFromNest] dengan default 0 (Decimal Prisma = string).
num _numFromNest(Object? v) => numFromNest(v) ?? 0;

/// Ringkasan stok (produk + sparepart) & mutasi terakhir — pengganti query
/// Supabase langsung pada migrasi Flutter -> Nest (`GET /products`,
/// `/spareparts`, `/stock/movements`, semuanya sudah dipakai web). Diurutkan
/// stok naik di sisi client (endpoint Nest urut nama, bukan stok) supaya item
/// menipis tetap tampil duluan seperti sebelumnya. Pengurangan otomatis
/// terjadi via checkout / pemakaian material; mutasi manual lewat
/// [adjustStockCallerProvider].
final stockOverviewProvider =
    FutureProvider.autoDispose<StockOverview>((ref) async {
  const api = ApiClient();
  final results = await Future.wait([
    api.get('/products') as Future<List>,
    api.get('/spareparts') as Future<List>,
    api.get('/stock/movements') as Future<List>,
  ]);
  final productRows = results[0];
  final sparepartRows = results[1];
  final movementRows = results[2];

  final products = [
    for (final r in productRows)
      StockRow(
        id: '${(r as Map)['id']}',
        kind: 'product',
        name: '${r['name']}',
        stock: _numFromNest(r['stock']),
      ),
  ]..sort((a, b) => a.stock.compareTo(b.stock));
  final spareparts = [
    for (final r in sparepartRows)
      StockRow(
        id: '${(r as Map)['id']}',
        kind: 'sparepart',
        name: '${r['name']}',
        stock: _numFromNest(r['stock']),
        min: _numFromNest(r['minStock']),
      ),
  ]..sort((a, b) => a.stock.compareTo(b.stock));

  return (
    products: products,
    spareparts: spareparts,
    movements: [
      for (final r in movementRows)
        MovementRow(
          name: '${(r as Map)['name']}',
          qtyChange: _numFromNest(r['qtyChange']),
          reason: '${r['reason']}',
          at: DateTime.tryParse('${r['createdAt']}')?.toLocal(),
        ),
    ],
  );
});

/// `POST /stock/adjust` (admin) — pengganti RPC `adjust_stock` pada migrasi
/// Flutter -> Nest. Payload sudah persis sama dengan `AdjustStockDto`
/// (dibangun di `buildAdjustPayload`, `stock_adjust_screen.dart`), diteruskan
/// apa adanya. Dipisah sebagai provider agar mudah di-override fake di test.
final adjustStockCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await const ApiClient().post('/stock/adjust', body: payload);
  };
});
