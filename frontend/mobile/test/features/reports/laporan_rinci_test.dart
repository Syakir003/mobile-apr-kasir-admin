import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/features/reports/laporan_rinci_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('groupByWeek', () {
    test('kosong -> kosong', () => expect(groupByWeek(const []), isEmpty));

    test('hari dalam satu minggu (Sen-Min) digabung ke Senin', () {
      // 2026-11-09 Senin .. 2026-11-15 Minggu
      final w = groupByWeek(const [
        DayPoint('2026-11-09', 100, 1),
        DayPoint('2026-11-15T00:00:00.000Z', 50, 2),
      ]);
      expect(w.length, 1);
      expect(w.single.start, '2026-11-09');
      expect(w.single.total, 150);
      expect(w.single.count, 3);
    });

    test('minggu kosong di antara yang terisi tetap tampil 0', () {
      final w = groupByWeek(const [
        DayPoint('2026-11-02', 10, 1), // Senin
        DayPoint('2026-11-17', 20, 1), // Selasa dua minggu kemudian
      ]);
      expect(w.map((e) => e.start), ['2026-11-02', '2026-11-09', '2026-11-16']);
      expect(w.map((e) => e.total), [10, 0, 20]);
    });
  });

  test('model laporan membaca angka (termasuk string) dari server', () {
    final p = ProfitLossReport({
      'ringkasan': {'totalPendapatan': '1000', 'totalHpp': 600, 'labaKotor': 400, 'marginPersen': 40},
      'detailPerItem': [
        {'name': 'Pipa', 'qtyTerjual': 2, 'revenue': 1000, 'hpp': 600, 'catatan': ''},
      ],
    });
    expect(p.pendapatan, 1000);
    expect(p.labaKotor, 400);
    expect(p.barisTanpaModal, 0);
    expect(p.detail.single['name'], 'Pipa');
    final s = SalesReport({
      'totalPenjualan': 5000,
      'totalInvoice': 2,
      'totalDiskon': 0,
      'totalPajak': 0,
      'breakdownKategori': [
        {'category': 'jasa', 'totalLine': 3000, 'qty': 3},
      ],
      'grafikHarian': [
        {'date': '2026-11-09', 'total': 5000, 'count': 2},
      ],
      'perTipePembeli': [
        {'tier': 'installer', 'total': 5000, 'count': 2},
      ],
    });
    expect(s.tipe.single.$1, 'installer');
    expect(tierLabel['installer'], 'Installer');
  });

  testWidgets('layar menampilkan empat tab dan isi Penjualan', (t) async {
    await t.pumpWidget(ProviderScope(
      overrides: [
        salesReportProvider.overrideWith((ref, r) => Future.value(SalesReport({
              'totalPenjualan': 1500000,
              'totalInvoice': 3,
              'totalDiskon': 0,
              'totalPajak': 0,
              'breakdownKategori': <Object>[],
              'grafikHarian': <Object>[],
              'perTipePembeli': <Object>[],
            }))),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const LaporanRinciScreen()),
    ));
    await t.pumpAndSettle();
    for (final tab in ['Penjualan', 'Servis', 'Laba-Rugi', 'Stok']) {
      expect(find.text(tab), findsWidgets);
    }
    expect(find.text('Rp 1.500.000'), findsOneWidget);
    expect(find.text('Total Penjualan'), findsOneWidget);
  });
}
