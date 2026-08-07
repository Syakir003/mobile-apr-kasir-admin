// Harness sementara: merender Dashboard admin jadi PNG untuk dibandingkan
// dengan frame `Dashboard Overview` (10:3) di Figma.
// Jalankan: flutter test --update-goldens test/dashboard_preview_golden.dart
import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/features/dashboard/dashboard_screen.dart';
import 'package:epos_ac/features/notifications/notifications_providers.dart';
import 'package:epos_ac/features/reports/reports_providers.dart';
import 'package:epos_ac/features/transactions/invoice_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _loadFont(String family, List<String> assets) async {
  final loader = FontLoader(family);
  for (final a in assets) {
    loader.addFont(rootBundle.load(a));
  }
  await loader.load();
}

Invoice _inv(
  String number,
  String customer,
  String item,
  int total,
  InvoiceStatus status,
) =>
    Invoice(
      id: number,
      number: number,
      transactionId: 't',
      memberId: '',
      customerName: customer,
      customerPhone: '',
      items: [
        InvoiceItem(
          kind: 'jasa',
          refId: 'r',
          name: item,
          unit: 'unit',
          qty: 1,
          unitPrice: total,
          lineTotal: total,
        ),
      ],
      subtotal: total,
      discount: 0,
      taxPercent: 0,
      taxAmount: 0,
      transportFee: 0,
      grandTotal: total,
      totalPaid: status == InvoiceStatus.lunas ? total : 0,
      status: status,
    );

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

  testWidgets('dashboard admin', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1020, 1500));

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final analytics = Analytics(
      salesToday: 24500000,
      salesWeek: 128500000,
      salesMonth: 512000000,
      txToday: 12,
      txMonth: 142,
      unpaidCount: 7,
      piutang: 3400000,
      paymentsByMethod: const {},
      lowStock: const [
        LowStockItem(name: 'Kompresor 1PK', stock: 2, min: 5),
        LowStockItem(name: 'Freon R32', stock: 1, min: 4),
      ],
      inventoryValue: 0,
      jobsByStatus: const {},
      dailySales: [
        for (var i = 6; i >= 0; i--)
          DaySales(
            date: today.subtract(Duration(days: i)),
            total: [12, 18, 9, 24, 15, 21, 17][6 - i] * 1000000,
            count: 3,
          ),
      ],
      topProducts: const [],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserProvider.overrideWith(
            (ref) => Stream.value(
              const AppUser(
                uid: 'u1',
                email: 'admin@ayub.id',
                displayName: 'Ayub Podo Rukun',
                role: UserRole.admin,
              ),
            ),
          ),
          analyticsProvider.overrideWith((ref) async => analytics),
          notificationsStreamProvider.overrideWith((ref) => Stream.value([])),
          invoicesStreamProvider.overrideWith(
            (ref) => Stream.value([
              _inv('INV-20260806-001', 'PT Maju Jaya Sentosa',
                  'Instalasi AC Sentral', 12500000, InvoiceStatus.lunas),
              _inv('INV-20260806-002', 'Budi Santoso', 'Service Cuci AC Split',
                  350000, InvoiceStatus.dp),
              _inv('INV-20260806-003', 'RS Medika Utama',
                  'Pengadaan Sparepart Kompresor', 8250000,
                  InvoiceStatus.lunas),
              _inv('INV-20260806-004', 'Hotel Mulia Asri',
                  'Maintenance Bulanan 20 Unit', 3400000,
                  InvoiceStatus.belumDibayar),
            ]),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const DashboardScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(DashboardScreen),
      matchesGoldenFile('preview_dashboard.png'),
    );
  });
}
