import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/utils/currency.dart';
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
    this.batchTracked = false,
  });

  final String id;

  /// 'product' | 'sparepart' — dikirim apa adanya sebagai `itemKind` ke RPC.
  final String kind;
  final String name;
  final num stock;
  final num? min;

  /// Sparepart per gulungan: barang masuk diisi panjang tiap gulungan, bukan satu jumlah.
  final bool batchTracked;

  bool get low => min == null ? stock <= 3 : stock <= min!;

  StockLevel get level => stock <= 0
      ? StockLevel.habis
      : low
          ? StockLevel.menipis
          : StockLevel.aman;
}

/// Habis = stok 0; menipis = masih ada tapi di bawah/pada batas minimum.
enum StockLevel { habis, menipis, aman }

typedef StockCounts = ({int habis, int menipis, int aman});

StockCounts stockCounts(Iterable<StockRow> rows) {
  var habis = 0, menipis = 0, aman = 0;
  for (final r in rows) {
    switch (r.level) {
      case StockLevel.habis:
        habis++;
      case StockLevel.menipis:
        menipis++;
      case StockLevel.aman:
        aman++;
    }
  }
  return (habis: habis, menipis: menipis, aman: aman);
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
  // `api.get` bertipe Future<dynamic>; meng-cast Future-nya ke Future<List>
  // gagal saat runtime (build rilis), jadi cast isinya setelah selesai.
  Future<List> getList(String path) async => await api.get(path) as List;
  final results = await Future.wait([
    getList('/products'),
    getList('/spareparts'),
    getList('/stock/movements'),
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
        batchTracked: r['batchTracked'] == true,
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

/// Muatan `POST /stock/in` (barang masuk dengan harga modal, membentuk batch modal untuk HPP). Produk dan sparepart
/// biasa memakai [qty]; sparepart per gulungan memakai [rolls] (panjang tiap gulungan) dan mengabaikan qty.
Map<String, dynamic> buildStockInPayload({
  required StockRow item,
  num? qty,
  List<num> rolls = const [],
  required num buyPrice,
  String supplier = '',
  String note = '',
  bool confirmOverride = false,
}) =>
    {
      'kind': item.kind,
      'refId': item.id,
      if (item.kind == 'sparepart' && item.batchTracked)
        'rolls': [for (final l in rolls) {'length': l}]
      else
        'qty': qty,
      'buyPrice': buyPrice,
      if (supplier.trim().isNotEmpty) 'supplierName': supplier.trim(),
      if (note.trim().isNotEmpty) 'note': note.trim(),
      if (confirmOverride) 'confirmOverride': true,
    };

/// Hasil barang masuk: [warnings] terisi bila server meminta konfirmasi (modal di bawah/sama dengan harga jual).
typedef StockInResult = ({bool needsConfirm, List<String> warnings});

StockInResult parseStockInResult(Object? response) {
  if (response is Map && response['status'] == 'confirm_required') {
    String rp(Object? v) => formatRupiahNum(_numFromNest(v));
    return (
      needsConfirm: true,
      warnings: [
        for (final w in (response['warnings'] as List? ?? const []))
          '${(w as Map)['name']}: harga modal ${rp(w['buyPrice'])} tidak di atas harga jual ${rp(w['sellPrice'])}',
      ],
    );
  }
  return (needsConfirm: false, warnings: const []);
}

/// `POST /stock/in` (admin & gudang).
final stockInCallerProvider =
    Provider<Future<StockInResult> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async => parseStockInResult(await const ApiClient().post('/stock/in', body: payload));
});
