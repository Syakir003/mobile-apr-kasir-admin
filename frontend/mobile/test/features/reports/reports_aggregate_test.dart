import 'package:epos_ac/features/reports/reports_providers.dart';
import 'package:flutter_test/flutter_test.dart';

// created_at tanpa 'Z' → diperlakukan waktu lokal, jadi bucketing deterministik
// lintas timezone runner.
Map<String, dynamic> _inv(String date, int total, {String status = 'lunas'}) =>
    {'created_at': '${date}T10:00:00', 'grand_total': total, 'status': status};

Map<String, dynamic> _item(String name, num qty, int lineTotal,
        {String status = 'lunas'}) =>
    {
      'name': name,
      'qty': qty,
      'line_total': lineTotal,
      'invoices': {'status': status, 'created_at': '2026-07-10T10:00:00'},
    };

void main() {
  group('bucketDailySales', () {
    final today = DateTime(2026, 7, 17, 14, 30);

    test('menghasilkan 14 ember berurutan berakhir hari ini', () {
      final r = bucketDailySales(const [], today);
      expect(r.length, 14);
      expect(r.first.date, DateTime(2026, 7, 4));
      expect(r.last.date, DateTime(2026, 7, 17));
      expect(r.every((d) => d.total == 0 && d.count == 0), isTrue);
    });

    test('mengelompokkan total & jumlah per hari lokal', () {
      final r = bucketDailySales([
        _inv('2026-07-17', 100000),
        _inv('2026-07-17', 25000),
        _inv('2026-07-16', 50000),
        _inv('2026-07-04', 10000),
      ], today);
      expect(r.last.total, 125000); // 17 Juli: dua invoice
      expect(r.last.count, 2);
      expect(r[12].total, 50000); // 16 Juli
      expect(r[12].count, 1);
      expect(r.first.total, 10000); // 4 Juli (awal window)
    });

    test('abaikan batal/refund dan di luar window', () {
      final r = bucketDailySales([
        _inv('2026-07-17', 100000, status: 'batal'),
        _inv('2026-07-17', 40000, status: 'refund'),
        _inv('2026-07-03', 99999), // sebelum window
      ], today);
      expect(r.fold<int>(0, (s, d) => s + d.total), 0);
      expect(r.fold<int>(0, (s, d) => s + d.count), 0);
    });
  });

  group('aggregateTopProducts', () {
    test('agregasi per nama, urut omzet menurun', () {
      final r = aggregateTopProducts([
        _item('AC 1PK', 1, 200000),
        _item('AC 1PK', 2, 300000), // AC 1PK → qty 3, omzet 500000
        _item('Bracket', 1, 800000),
        _item('Pipa', 3, 100000),
      ]);
      expect(r.map((e) => e.name).toList(),
          ['Bracket', 'AC 1PK', 'Pipa']); // 800k > 500k > 100k
      expect(r[1].qty, 3);
      expect(r[1].revenue, 500000);
    });

    test('hormati limit dan abaikan item invoice batal/refund', () {
      final r = aggregateTopProducts([
        _item('A', 1, 800000),
        _item('B', 1, 500000),
        _item('C', 1, 300000),
        _item('Void', 1, 999999, status: 'batal'),
      ], limit: 2);
      expect(r.map((e) => e.name).toList(), ['A', 'B']);
      expect(r.any((e) => e.name == 'Void'), isFalse);
    });
  });
}
