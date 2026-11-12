import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/service_item.dart';
import 'package:epos_ac/features/jobs/service_pricing_card.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

ServicePricing _data({bool editable = true}) => ServicePricing.fromJson({
      'editable': editable,
      'priced': false,
      'findingsSentAt': null,
      'invoice': null,
      'lines': <Object>[],
      'transport': {'level': 0, 'mode': 'individu', 'amount': 0},
      'sparepart': {'total': 0, 'requests': <Object>[]},
    });

Widget _app({bool editable = true}) => ProviderScope(
      overrides: [
        servicePricingProvider.overrideWith((ref, id) => Future.value(_data(editable: editable))),
        serviceListProvider.overrideWith(
          (ref) => Stream.value(const [ServiceItem(id: 's1', name: 'Cuci AC', category: 'cuci', basePrice: 80000)]),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(body: SingleChildScrollView(child: ServicePricingCard(jobId: 'j1'))),
      ),
    );

void main() {
  testWidgets('baris kosong: tombol Tetapkan mati; isi jasa lain + harga + transport -> total & tombol aktif', (t) async {
    await t.pumpWidget(_app());
    await t.pumpAndSettle();

    FilledButton save() => t.widget<FilledButton>(find.byKey(const Key('pricing-save')));
    expect(find.text('Tetapkan Harga Jasa'), findsOneWidget);
    expect(save().onPressed, isNull);

    await t.enterText(find.widgetWithText(TextField, 'Nama jasa, mis. Bongkar kompresor'), 'Bongkar kompresor');
    await t.enterText(find.widgetWithText(TextField, 'Harga satuan'), '250000');
    await t.pump();
    expect(save().onPressed, isNotNull);
    expect(t.widget<Text>(find.byKey(const Key('pricing-total'))).data, 'Rp 250.000');

    // Transport 2 = Rp 200.000 sebagai baris tersendiri.
    await t.tap(find.byKey(const Key('pricing-transport')));
    await t.pumpAndSettle();
    await t.tap(find.textContaining('Transport 2').last);
    await t.pumpAndSettle();
    expect(t.widget<Text>(find.byKey(const Key('pricing-total'))).data, 'Rp 450.000');
    expect(find.textContaining('Biaya transport'), findsWidgets);
  });

  testWidgets('job selesai (tidak editable): tanpa tombol simpan, ada keterangan', (t) async {
    await t.pumpWidget(_app(editable: false));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('pricing-save')), findsNothing);
    expect(find.textContaining('tidak bisa diubah'), findsOneWidget);
  });
}
