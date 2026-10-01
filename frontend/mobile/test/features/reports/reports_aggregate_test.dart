import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/reports/reports_providers.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('dailyBucketsFromNest', () {
    test('memetakan grafikHarian ke map tanggal', () {
      final buckets = dailyBucketsFromNest([
        {'date': '2026-07-17T00:00:00.000Z', 'total': 100000, 'count': 2},
        {'date': '2026-07-16', 'total': 50000, 'count': 1},
      ]);
      expect(buckets['2026-07-17'], (total: 100000, count: 2));
      expect(buckets['2026-07-16'], (total: 50000, count: 1));
    });

    test('list kosong -> map kosong', () {
      expect(dailyBucketsFromNest(const []), isEmpty);
    });
  });

  group('sumTotalSince / sumCountSince', () {
    final buckets = {
      '2026-07-17': (total: 100000, count: 2),
      '2026-07-16': (total: 50000, count: 1),
      '2026-07-03': (total: 10000, count: 1),
    };

    test('cuma menjumlah tanggal >= since', () {
      expect(sumTotalSince(buckets, DateTime(2026, 7, 16)), 150000);
      expect(sumCountSince(buckets, DateTime(2026, 7, 16)), 3);
    });

    test('since sebelum semua data -> jumlah semuanya', () {
      expect(sumTotalSince(buckets, DateTime(2026, 1, 1)), 160000);
    });
  });

  group('buildDailySales', () {
    test('menghasilkan N ember berurutan berakhir di lastDay, hari kosong nol', () {
      final r = buildDailySales(
        {'2026-07-17': (total: 100000, count: 2)},
        DateTime(2026, 7, 17, 14, 30),
        days: 14,
      );
      expect(r.length, 14);
      expect(r.first.date, DateTime(2026, 7, 4));
      expect(r.last.date, DateTime(2026, 7, 17));
      expect(r.last.total, 100000);
      expect(r.last.count, 2);
      expect(r.first.total, 0);
    });
  });

  group('unpaidCountFromNest', () {
    test('menjumlah count semua status', () {
      final n = unpaidCountFromNest([
        {'status': 'belum_dibayar', 'count': 3},
        {'status': 'dp', 'count': 2},
      ]);
      expect(n, 5);
    });

    test('list kosong -> nol', () {
      expect(unpaidCountFromNest(const []), 0);
    });
  });

  group('jobsByStatusFromNest', () {
    test('memetakan status Nest ke JobStatus', () {
      final m = jobsByStatusFromNest([
        {'status': 'assigned', 'count': 4},
        {'status': 'sedang_dikerjakan', 'count': 2},
      ]);
      expect(m[JobStatus.assigned], 4);
      expect(m[JobStatus.sedangDikerjakan], 2);
      expect(m.containsKey(JobStatus.selesai), isFalse);
    });
  });

  group('topProductsFromNest', () {
    test('urut omzet menurun & dibatasi limit', () {
      final r = topProductsFromNest([
        {'name': 'A', 'qtyTerjual': 1, 'revenue': 800000},
        {'name': 'B', 'qtyTerjual': 1, 'revenue': 500000},
        {'name': 'C', 'qtyTerjual': 1, 'revenue': 300000},
      ], limit: 2);
      expect(r.map((e) => e.name).toList(), ['A', 'B']);
    });
  });

  group('lowStockFromOverview', () {
    test('cuma item di bawah/sama minimum yang ikut', () {
      const stock = (
        products: [
          StockRow(id: 'p1', kind: 'product', name: 'Aman', stock: 10),
          StockRow(id: 'p2', kind: 'product', name: 'Menipis', stock: 2),
        ],
        spareparts: [
          StockRow(id: 's1', kind: 'sparepart', name: 'Freon', stock: 1, min: 4),
        ],
        movements: <MovementRow>[],
      );
      final low = lowStockFromOverview(stock);
      expect(low.map((e) => e.name).toList(), ['Menipis', 'Freon']);
    });
  });
}
