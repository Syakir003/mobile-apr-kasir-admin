import 'package:epos_ac/features/reports/stock_report_logic.dart';
import 'package:epos_ac/features/reports/stock_report_pdf.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> row(
  String name, {
  String kind = 'product',
  String? brand,
  num awal = 0,
  num masuk = 0,
  num keluar = 0,
  num sisa = 0,
  String? pairRole,
  Map<String, dynamic>? gabungan,
}) =>
    {
      'itemKind': kind,
      'refId': name,
      'name': name,
      'brand': brand,
      'unit': 'unit',
      'stokAwal': '$awal', // Decimal Prisma tiba sebagai string
      'stokMasuk': masuk,
      'stokKeluar': keluar,
      'sisaStok': sisa,
      if (pairRole != null) 'pairRole': pairRole,
      if (gabungan != null) 'unitGabungan': gabungan,
    };

List<StockMovementRow> rows(List<Map<String, dynamic>> js) => [for (final j in js) StockMovementRow.fromJson(j)];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized(); // PDF memuat font dari rootBundle

  test('fromJson menerima angka string dari Nest dan role gudang tanpa angka uang', () {
    final r = StockMovementRow.fromJson(row('A', awal: 3, sisa: 5, brand: 'Daikin'));
    expect(r.stokAwal, 3);
    expect(r.sisaStok, 5);
    expect(r.modalTersisa, isNull);
    expect(r.keluar, isEmpty);
  });

  test('groupStockRows: merk A-Z, Sparepart paling bawah, total sisa per grup', () {
    final groups = groupStockRows(rows([
      row('Kabel', kind: 'sparepart', sisa: 4),
      row('LG 1', brand: 'LG', sisa: 2),
      row('Daikin 1', brand: 'Daikin', sisa: 1),
      row('Daikin 2', brand: 'Daikin', sisa: 3),
      row('Tanpa', sisa: 9),
    ]));
    expect(groups.map((g) => g.label), ['Daikin', 'LG', 'Tanpa merk', 'Sparepart']);
    expect(groups.first.totalSisa, 4);
  });

  test('hideEmptyRows menyembunyikan barang kosong, paket Indoor+Outdoor hanya bila keduanya kosong', () {
    final items = rows([
      row('Kosong'),
      row('Ada', sisa: 1),
      row('Paket A Indoor', pairRole: 'indoor', gabungan: {'namaPasangan': 'Paket A Outdoor', 'sisaStok': 0}),
      row('Paket A Outdoor', pairRole: 'outdoor'),
      row('Paket B Indoor', pairRole: 'indoor', gabungan: {'namaPasangan': 'Paket B Outdoor', 'sisaStok': 0}),
      row('Paket B Outdoor', pairRole: 'outdoor', sisa: 2),
    ]);
    final r = hideEmptyRows(items);
    expect(r.hidden, 3);
    expect(r.shown.map((x) => x.name), ['Ada', 'Paket B Indoor', 'Paket B Outdoor']);
  });

  test('isPackageOutdoor: hanya Outdoor tepat di bawah Indoor paketnya', () {
    final items = rows([
      row('X Indoor', pairRole: 'indoor', gabungan: {'namaPasangan': 'X Outdoor', 'sisaStok': 1}),
      row('X Outdoor', pairRole: 'outdoor'),
      row('Y Outdoor', pairRole: 'outdoor'),
    ]);
    expect([for (var i = 0; i < items.length; i++) isPackageOutdoor(items, i)], [false, true, false]);
  });

  test('PDF Laporan Stok berhasil dibangun untuk gudang, admin, dan kosong (tanpa Helvetica)', () async {
    final groups = selectStockGroups(rows([
      row('D1', brand: 'Daikin', sisa: 2, masuk: 2),
      row('Kabel', kind: 'sparepart', sisa: 4),
    ])).groups;
    final gudang = await buildStockReportPdf(groups, from: '2026-11-01', to: '2026-11-19', showMoney: false, hidden: 1);
    expect(gudang.length, greaterThan(1000));
    expect(String.fromCharCodes(gudang).contains('Helvetica'), isFalse);
    final admin = await buildStockReportPdf(groups,
        from: '2026-11-01',
        to: '2026-11-19',
        showMoney: true,
        summary: (modal: 1000000, omzet: 2000000, untung: 1000000));
    expect(admin.length, greaterThan(1000));
    expect((await buildStockReportPdf(const [], from: '2026-11-01', to: '2026-11-19', showMoney: false)).length,
        greaterThan(1000));
  });

  test('selectStockGroups: saringan merk dan opsi tampilkan barang kosong', () {
    final all = rows([row('D', brand: 'Daikin', sisa: 1), row('L', brand: 'LG'), row('K', kind: 'sparepart')]);
    final byBrand = selectStockGroups(all, brand: 'Daikin');
    expect(byBrand.groups.map((g) => g.label), ['Daikin']);
    final withEmpty = selectStockGroups(all, showEmpty: true);
    expect(withEmpty.groups.length, 3);
    expect(withEmpty.hidden, 0);
    expect(selectStockGroups(all).hidden, 2);
  });
}
