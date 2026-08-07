// Harness sementara: merender form produk (yang sesungguhnya, bukan demo)
// jadi PNG untuk memeriksa hasil migrasi ke komponen design system.
// Jalankan: flutter test --update-goldens test/product_form_preview_golden.dart
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/product/product_form_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_crud_repository.dart';

Future<void> _loadFont(String family, List<String> assets) async {
  final loader = FontLoader(family);
  for (final a in assets) {
    loader.addFont(rootBundle.load(a));
  }
  await loader.load();
}

void main() {
  setUpAll(() async {
    await _loadFont('PlusJakartaSans', const [
      'assets/fonts/PlusJakartaSans-Medium.ttf',
      'assets/fonts/PlusJakartaSans-SemiBold.ttf',
      'assets/fonts/PlusJakartaSans-Bold.ttf',
    ]);
    await _loadFont('Inter', const [
      'assets/fonts/Inter-Regular.ttf',
      'assets/fonts/Inter-Medium.ttf',
      'assets/fonts/Inter-SemiBold.ttf',
    ]);
    await _loadFont('JetBrainsMono', const [
      'assets/fonts/JetBrainsMono-Medium.ttf',
      'assets/fonts/JetBrainsMono-Bold.ttf',
    ]);
  });

  testWidgets('form produk (edit)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(760, 1500));
    final repo = FakeCrudRepository<Product>();
    addTearDown(repo.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [productRepositoryProvider.overrideWithValue(repo)],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const ProductFormScreen(
            initial: Product(
              id: 'p1',
              name: 'AC Split Inverter Hemat Energi',
              brand: 'Daikin',
              type: 'FTKC25TVM4',
              pk: 1,
              inverter: true,
              btu: 9000,
              watt: 660,
              warranty: '1 tahun unit, 5 tahun kompresor',
              buyPrice: 3850000,
              sellPrice: 4650000,
              stock: 12,
              category: 'AC 1 PK',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(ProductFormScreen),
      matchesGoldenFile('preview_product_form.png'),
    );
  });
}
