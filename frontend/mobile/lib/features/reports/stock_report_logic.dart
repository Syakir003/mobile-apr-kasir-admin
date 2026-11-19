import '../../core/utils/num_parse.dart';

/// Satu baris Laporan Stok (`GET /reports/stock-movements`). Cerminan `StockReportRow` di web.
/// Kolom uang tidak dikirim server untuk role gudang, jadi null di sana.
class StockMovementRow {
  StockMovementRow({
    required this.isSparepart,
    required this.refId,
    required this.name,
    required this.brand,
    required this.unit,
    required this.stokAwal,
    required this.stokMasuk,
    required this.stokKeluar,
    required this.sisaStok,
    required this.masukDari,
    required this.keluar,
    this.pairRole,
    this.pairName,
    this.pairSisa,
    this.modalTersisa,
    this.omzetTerjual,
    this.untungTerjual,
    this.jualSatuanTanpaModal = 0,
  });

  final bool isSparepart;
  final String refId;
  final String name;
  final String? brand;
  final String unit;
  final num stokAwal;
  final num stokMasuk;
  final num stokKeluar;
  final num sisaStok;
  final String masukDari;
  final List<({String tanggal, String pihak, num qty})> keluar;

  /// 'indoor' | 'outdoor' bila bagian dari paket AC Split.
  final String? pairRole;

  /// Pada baris Indoor sebuah paket: nama Outdoor pasangannya dan jumlah set lengkap siap jual.
  final String? pairName;
  final num? pairSisa;
  final num? modalTersisa;
  final num? omzetTerjual;
  final num? untungTerjual;
  final num jualSatuanTanpaModal;

  factory StockMovementRow.fromJson(Map<String, dynamic> j) {
    final gabungan = j['unitGabungan'] is Map ? Map<String, dynamic>.from(j['unitGabungan'] as Map) : null;
    return StockMovementRow(
      isSparepart: j['itemKind'] == 'sparepart',
      refId: '${j['refId'] ?? ''}',
      name: '${j['name'] ?? ''}',
      brand: j['brand'] as String?,
      unit: '${j['unit'] ?? ''}',
      stokAwal: numFromNest(j['stokAwal']) ?? 0,
      stokMasuk: numFromNest(j['stokMasuk']) ?? 0,
      stokKeluar: numFromNest(j['stokKeluar']) ?? 0,
      sisaStok: numFromNest(j['sisaStok']) ?? 0,
      masukDari: '${j['masukDari'] ?? ''}',
      keluar: [
        for (final k in (j['keluarDetail'] as List? ?? const []))
          (
            tanggal: '${(k as Map)['tanggal'] ?? ''}',
            pihak: '${k['pihak'] ?? ''}',
            qty: numFromNest(k['qty']) ?? 0,
          ),
      ],
      pairRole: j['pairRole'] as String?,
      pairName: gabungan?['namaPasangan'] as String?,
      pairSisa: gabungan == null ? null : numFromNest(gabungan['sisaStok']) ?? 0,
      modalTersisa: numFromNest(j['modalTersisa']),
      omzetTerjual: numFromNest(j['omzetTerjual']),
      untungTerjual: numFromNest(j['untungTerjual']),
      jualSatuanTanpaModal: numFromNest(j['jualSatuanTanpaModal']) ?? 0,
    );
  }

  bool get isEmpty => stokAwal == 0 && stokMasuk == 0 && stokKeluar == 0 && sisaStok == 0;

  String get jenisLabel => switch (pairRole) {
        'indoor' => 'Indoor',
        'outdoor' => 'Outdoor',
        _ => isSparepart ? 'Sparepart' : 'Produk',
      };
}

class StockGroup {
  StockGroup(this.label);
  final String label;
  final List<StockMovementRow> rows = [];
  num totalSisa = 0;
}

const sparepartGroup = 'Sparepart';

/// Sparepart tidak bermerk: semuanya satu grup. Produk dikelompokkan per merk.
String groupLabel(StockMovementRow r) {
  if (r.isSparepart) return sparepartGroup;
  final b = r.brand?.trim() ?? '';
  return b.isEmpty ? 'Tanpa merk' : b;
}

/// Merk A-Z, Sparepart paling bawah. Urutan baris di dalam grup dipertahankan (Indoor/Outdoor tetap berdampingan
/// karena server sudah mengurutkannya).
List<StockGroup> groupStockRows(List<StockMovementRow> rows) {
  final map = <String, StockGroup>{};
  for (final r in rows) {
    final g = map.putIfAbsent(groupLabel(r), () => StockGroup(groupLabel(r)));
    g.rows.add(r);
    g.totalSisa += r.sisaStok;
  }
  return map.values.toList()
    ..sort((a, b) => a.label == sparepartGroup
        ? 1
        : b.label == sparepartGroup
            ? -1
            : a.label.compareTo(b.label));
}

/// Outdoor yang tampil tepat di bawah Indoor paketnya (tanpa nomor sendiri, menjorok).
bool isPackageOutdoor(List<StockMovementRow> rows, int i) =>
    i > 0 && rows[i].pairRole == 'outdoor' && rows[i - 1].pairName == rows[i].name;

/// Barang tanpa stok & tanpa pergerakan disembunyikan. Paket Indoor+Outdoor hanya disembunyikan bila KEDUANYA kosong,
/// supaya pasangan tidak terpisah.
({List<StockMovementRow> shown, int hidden}) hideEmptyRows(List<StockMovementRow> items) {
  final shown = <StockMovementRow>[];
  var hidden = 0;
  for (var i = 0; i < items.length; i++) {
    final r = items[i];
    final next = i + 1 < items.length ? items[i + 1] : null;
    final pairNext = r.pairName != null && next?.pairRole == 'outdoor' && next?.name == r.pairName ? next : null;
    final unit = [r, if (pairNext != null) pairNext];
    if (unit.every((x) => x.isEmpty)) {
      hidden += unit.length;
    } else {
      shown.addAll(unit);
    }
    if (pairNext != null) i++;
  }
  return (shown: shown, hidden: hidden);
}

/// Baris yang akan tampil/dicetak: saringan merk (null = semua) lalu sembunyikan barang kosong kecuali [showEmpty].
({List<StockGroup> groups, int hidden}) selectStockGroups(
  List<StockMovementRow> all, {
  String? brand,
  bool showEmpty = false,
}) {
  final scoped = [for (final r in all) if (brand == null || groupLabel(r) == brand) r];
  final r = showEmpty ? (shown: scoped, hidden: 0) : hideEmptyRows(scoped);
  return (groups: groupStockRows(r.shown), hidden: r.hidden);
}
