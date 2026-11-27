import 'package:epos_ac/features/stock/receive_providers.dart';
import 'package:epos_ac/features/stock/receive_screen.dart';
import 'package:epos_ac/features/stock/stock_label_pdf.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const _paket = ReceiveItem(id: 'in', kind: 'product', name: 'AC Sharp Indoor', unit: 'unit', outdoorId: 'out');
const _tunggal = ReceiveItem(id: 'p2', kind: 'product', name: 'AC Window', unit: 'unit');
const _pipa = ReceiveItem(id: 's1', kind: 'sparepart', name: 'Pipa', unit: 'm', batchTracked: true);

Future<void> _pump(WidgetTester tester, List<Map<String, dynamic>> sent,
    {Map<String, dynamic> response = const {'status': 'ok', 'batchId': 'b1', 'name': 'AC Sharp Indoor'}}) async {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      receiveItemsProvider.overrideWith((ref) async => const [_paket, _tunggal, _pipa]),
      receiveCallerProvider.overrideWithValue((payload) async {
        sent.add(payload);
        return response;
      }),
    ],
    child: const MaterialApp(home: ReceiveScreen()),
  ));
  await tester.pumpAndSettle();
}

Future<void> _pick(WidgetTester tester, String name) async {
  await tester.tap(find.byKey(const Key('receive-item')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(name).last);
  await tester.pumpAndSettle();
}

Future<void> _save(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('receive-save')));
  await tester.pumpAndSettle();
}

void main() {
  group('buildReceivePayload', () {
    test('paket: Indoor dan Outdoor, tanpa harga', () {
      expect(buildReceivePayload(_paket, qty: 3, outdoorQty: 2, supplier: ' PT A '), {
        'kind': 'product',
        'refId': 'in',
        'qty': 3,
        'outdoorQty': 2,
        'pairMode': 'lengkap',
        'outdoorRefId': 'out',
        'supplierName': 'PT A',
      });
    });

    test('gulungan: panjang tiap gulungan', () {
      expect(buildReceivePayload(_pipa, rolls: [15, 12.5]), {
        'kind': 'sparepart',
        'refId': 's1',
        'rolls': [
          {'length': 15},
          {'length': 12.5},
        ],
      });
    });

    test('tidak pernah membawa buyPrice', () {
      for (final p in [
        buildReceivePayload(_paket, qty: 1, outdoorQty: 1),
        buildReceivePayload(_tunggal, qty: 1),
        buildReceivePayload(_pipa, rolls: [1]),
      ]) {
        expect(p.containsKey('buyPrice'), isFalse);
      }
    });
  });

  test('receiveItemsFrom: Outdoor milik paket tidak ditawarkan', () {
    final items = receiveItemsFrom(
      products: [
        {'id': 'in', 'name': 'Indoor', 'pairedProductId': 'out'},
        {'id': 'out', 'name': 'Outdoor', 'pairedProductId': null},
        {'id': 'p2', 'name': 'Window'},
      ],
      spareparts: [
        {'id': 's1', 'name': 'Pipa', 'unit': 'm', 'batchTracked': true},
      ],
    );
    expect(items.map((i) => i.id), ['in', 'p2', 's1']);
    expect(items.first.outdoorId, 'out');
    expect(items.last.batchTracked, isTrue);
  });

  test('receiveItemsFrom: barang menunggu harga tetap bisa diterima, yang dinonaktifkan tidak', () {
    final items = receiveItemsFrom(products: [], spareparts: [
      {'id': 'baru', 'name': 'Baru', 'unit': 'kg', 'active': false, 'sellPrice': '0'},
      {'id': 'mati', 'name': 'Mati', 'unit': 'kg', 'active': false, 'sellPrice': '5000'},
    ]);
    expect(items.map((i) => i.id), ['baru']);
  });

  testWidgets('paket: isi Indoor & Outdoor, tidak ada kolom harga, lalu bisa cetak label', (tester) async {
    final sent = <Map<String, dynamic>>[];
    await _pump(tester, sent, response: {
      'status': 'ok', 'batchId': 'b1', 'outdoorBatchId': 'b2',
      'name': 'AC Sharp Indoor', 'outdoorName': 'AC Sharp Outdoor',
    });
    await _pick(tester, 'AC Sharp Indoor');
    expect(find.textContaining('Harga'), findsNothing);
    await tester.enterText(find.byKey(const Key('receive-qty')), '3');
    await tester.enterText(find.byKey(const Key('receive-outdoor-qty')), '3');
    await _save(tester);

    expect(sent.single['qty'], 3);
    expect(sent.single['outdoorQty'], 3);
    expect(sent.single.containsKey('buyPrice'), isFalse);
    expect(find.text('Cetak Label'), findsOneWidget);
    expect(find.byKey(const Key('receive-save')), findsNothing); // tidak bisa tersimpan dua kali
  });

  testWidgets('jumlah kosong atau nol: tombol simpan mati', (tester) async {
    final sent = <Map<String, dynamic>>[];
    await _pump(tester, sent);
    await _pick(tester, 'AC Window');
    await _save(tester);
    expect(sent, isEmpty);
  });

  testWidgets('gulungan: tambah gulungan; sparepart tidak punya tombol label', (tester) async {
    final sent = <Map<String, dynamic>>[];
    await _pump(tester, sent, response: {'status': 'ok', 'name': 'Pipa'});
    await _pick(tester, 'Pipa');
    await tester.enterText(find.byKey(const Key('receive-roll-0')), '15');
    await tester.tap(find.byKey(const Key('receive-add-roll')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('receive-roll-1')), '12,5');
    await tester.pumpAndSettle();
    await _save(tester);

    expect(sent.single['rolls'], [
      {'length': 15},
      {'length': 12.5},
    ]);
    expect(find.text('Cetak Label'), findsNothing);
  });

  group('label stok', () {
    test('baris dari unit: kode, token, nama, dan peran', () {
      final labels = stockLabelsFrom(
        [
          {'unitCode': 'PRD-1-U0001', 'qrToken': 't1'},
        ],
        name: 'AC Sharp',
        role: 'indoor',
      );
      expect(labels.single.code, 'PRD-1-U0001');
      expect(labels.single.qrToken, 't1');
      expect(labels.single.name, 'AC Sharp');
      expect(labels.single.roleText, 'INDOOR');
    });

    test('PDF terbentuk', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      final bytes = await buildStockLabelsPdf(
          [const StockLabel(code: 'C1', qrToken: 't', name: 'AC', roleText: 'OUTDOOR')]);
      expect(bytes.length, greaterThan(1000));
    });
  });
}
