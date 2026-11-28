import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/models/service_item.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/sparepart/sparepart_list_screen.dart';
import 'package:epos_ac/features/pos/item_picker_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// Barang yang diinput dari HP lain (mis. gudang) harus muncul saat daftar/POS dibuka,
// tanpa harus menutup aplikasi.

void main() {
  for (final (label, screen) in <(String, Widget)>[
    ('pemilih barang POS', const Scaffold(body: ItemPickerSheet())),
    ('daftar sparepart', const SparepartListScreen()),
  ]) {
    testWidgets('$label: dibuka lagi = diambil ulang dari server', (tester) async {
      var fetched = 0;
      final container = ProviderContainer(overrides: [
        currentUserProvider.overrideWith((ref) =>
            Stream.value(const AppUser(uid: 'a', email: 'e', displayName: 'A', role: UserRole.admin))),
        sparepartListProvider.overrideWith((ref) {
          fetched++;
          return Stream.value(const <Sparepart>[]);
        }),
        productListProvider.overrideWith((ref) => Stream.value(const <Product>[])),
        serviceListProvider.overrideWith((ref) => Stream.value(const <ServiceItem>[])),
      ]);
      addTearDown(container.dispose);
      Widget app(Widget home) =>
          UncontrolledProviderScope(container: container, child: MaterialApp(home: home));

      await tester.pumpWidget(app(screen));
      await tester.pumpAndSettle();
      await tester.pumpWidget(app(const SizedBox()));
      final before = fetched;
      await tester.pumpWidget(app(screen));
      await tester.pumpAndSettle();

      expect(fetched, greaterThan(before));
    });
  }
}
