import 'package:epos_ac/features/keluar_gudang/keluar_gudang_providers.dart';
import 'package:epos_ac/features/keluar_gudang/keluar_gudang_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

const _lineAda = FulfillmentLine(
  refId: 'r1',
  productName: 'AC Daikin 1 PK',
  acRole: 'indoor',
  pairName: 'Outdoor Daikin 1 PK',
  qtyTotal: 2,
  qtyFulfilled: 1,
  qtyRemaining: 1,
);

InvoiceFulfillment _invoice({bool done = false}) => InvoiceFulfillment(
      invoiceId: 'inv1',
      invoiceNumber: 'INV-0001',
      customerName: 'Budi',
      lines: [
        done
            ? const FulfillmentLine(
                refId: 'r1',
                productName: 'AC Daikin 1 PK',
                qtyTotal: 2,
                qtyFulfilled: 2,
                qtyRemaining: 0,
              )
            : _lineAda,
      ],
    );

class _FakeApi extends KeluarGudangApi {
  _FakeApi({this.error});
  final Object? error;
  final scans = <String>[];
  final manuals = <String>[];

  @override
  Future<FulfillResult> scan(String invoiceId, String code) async {
    scans.add(code);
    if (error != null) throw error!;
    return const FulfillResult(
        unitCode: 'PRD-0001-U0007', productName: 'AC Daikin 1 PK', acRole: 'indoor');
  }

  @override
  Future<FulfillResult> manual(String invoiceId, String refId) async {
    manuals.add(refId);
    return const FulfillResult(unitCode: 'PRD-0001-U0001');
  }
}

Widget _wrap(Widget home, _FakeApi api, {InvoiceFulfillment? invoice}) {
  return ProviderScope(
    overrides: [
      keluarGudangApiProvider.overrideWithValue(api),
      invoiceFulfillmentProvider
          .overrideWith((ref, id) => Future.value(invoice ?? _invoice())),
      pendingInvoicesProvider.overrideWith((ref) => Future.value([
            PendingInvoice(
              invoiceId: 'inv1',
              invoiceNumber: 'INV-0001',
              customerName: 'Budi',
              createdAt: DateTime(2026, 11, 1),
              pendingUnits: 1,
            ),
          ])),
    ],
    child: MaterialApp(home: home),
  );
}

void main() {
  test('InvoiceFulfillment.fromMap menerima angka string/num dari Nest', () {
    final inv = InvoiceFulfillment.fromMap({
      'invoiceId': 'i',
      'invoiceNumber': 'INV-1',
      'customerName': null,
      'lines': [
        {
          'refId': 'r',
          'productName': 'AC',
          'acRole': null,
          'pairName': null,
          'qtyTotal': '3',
          'qtyFulfilled': 1,
          'qtyRemaining': '2',
        },
      ],
    });
    expect(inv.totalUnits, 3);
    expect(inv.doneUnits, 1);
    expect(inv.allDone, isFalse);
  });

  testWidgets('daftar: menampilkan invoice yang menunggu dikeluarkan',
      (tester) async {
    final router = GoRouter(routes: [
      GoRoute(path: '/', builder: (_, __) => const KeluarGudangScreen()),
      GoRoute(
        path: '/keluar-gudang/:invoiceId',
        builder: (_, s) => Scaffold(body: Text('detail ${s.pathParameters['invoiceId']}')),
      ),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        pendingInvoicesProvider.overrideWith((ref) => Future.value([
              const PendingInvoice(
                invoiceId: 'inv1',
                invoiceNumber: 'INV-0001',
                customerName: 'Budi',
                pendingUnits: 2,
              ),
            ])),
      ],
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.pumpAndSettle();

    expect(find.text('INV-0001'), findsOneWidget);
    expect(find.text('2 unit'), findsOneWidget);
    await tester.tap(find.byKey(const Key('pending-inv1')));
    await tester.pumpAndSettle();
    expect(find.text('detail inv1'), findsOneWidget);
  });

  testWidgets('detail: kirim kode label memanggil scan dan menampilkan hasil',
      (tester) async {
    final api = _FakeApi();
    await tester.pumpWidget(_wrap(
        const KeluarGudangDetailScreen(invoiceId: 'inv1', showCamera: false), api));
    await tester.pumpAndSettle();

    expect(find.text('1 dari 2 unit sudah keluar'), findsWidgets);
    await tester.enterText(find.byKey(const Key('kode-input')), 'PRD-0001-U0007');
    await tester.tap(find.byKey(const Key('kode-kirim')));
    await tester.pumpAndSettle();

    expect(api.scans, ['PRD-0001-U0007']);
    expect(find.textContaining('PRD-0001-U0007 · AC Daikin 1 PK (Indoor) sudah keluar'),
        findsOneWidget);
  });

  testWidgets('detail: error dari backend tampil sebagai banner, bukan crash',
      (tester) async {
    final api = _FakeApi(error: Exception('Unit ini udah pernah dikeluarkan'));
    await tester.pumpWidget(_wrap(
        const KeluarGudangDetailScreen(invoiceId: 'inv1', showCamera: false), api));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('kode-input')), 'XYZ');
    await tester.tap(find.byKey(const Key('kode-kirim')));
    await tester.pumpAndSettle();

    expect(find.text('Unit ini udah pernah dikeluarkan'), findsOneWidget);
  });

  testWidgets('detail: tandai manual butuh konfirmasi', (tester) async {
    final api = _FakeApi();
    await tester.pumpWidget(_wrap(
        const KeluarGudangDetailScreen(invoiceId: 'inv1', showCamera: false), api));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('manual-r1')));
    await tester.pumpAndSettle();
    expect(api.manuals, isEmpty, reason: 'belum dikonfirmasi');

    await tester.tap(find.byKey(const Key('manual-confirm')));
    await tester.pumpAndSettle();
    expect(api.manuals, ['r1']);
    expect(find.textContaining('ditandai keluar (manual)'), findsOneWidget);
  });

  testWidgets('detail: semua unit keluar -> pemindai disembunyikan', (tester) async {
    await tester.pumpWidget(_wrap(
      const KeluarGudangDetailScreen(invoiceId: 'inv1', showCamera: false),
      _FakeApi(),
      invoice: _invoice(done: true),
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('kode-input')), findsNothing);
    expect(find.textContaining('Semua unit di invoice ini sudah keluar'),
        findsOneWidget);
  });
}
