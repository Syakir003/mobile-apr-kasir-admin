import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/features/jobs/service_pricing_card.dart';

typedef L = ({String name, num qty, num unitPrice});

void main() {
  const jasa = <L>[(name: 'Cuci AC', qty: 2, unitPrice: 100000)];
  const part = <L>[(name: 'Pipa', qty: 3, unitPrice: 50000)];

  test('tanpa transport: jasa + sparepart apa adanya', () {
    final p = buildPricingPreview(jasa, part, 0, 'individu');
    expect(p.map((l) => l.lineTotal), [200000, 150000]);
  });

  test('transport individu: baris Biaya transport sendiri', () {
    final p = buildPricingPreview(jasa, part, 200000, 'individu');
    expect(p.last.name, 'Biaya transport');
    expect(p.fold<int>(0, (s, l) => s + l.lineTotal), 550000);
  });

  test('transport dibagi: total tetap, sisa pembulatan ke baris pertama', () {
    final p = buildPricingPreview(jasa, part, 100001, 'dibagi');
    expect(p.length, 2); // tidak ada baris transport
    expect(p.first.lineTotal, 200000 + 50001); // 100001 ~/ 2 = 50000, sisa 1 ke baris pertama
    expect(p.last.lineTotal, 150000 + 50000);
    expect(p.fold<int>(0, (s, l) => s + l.lineTotal), 350000 + 100001);
  });

  test('transport dibagi tanpa baris apa pun jatuh ke baris transport', () {
    final p = buildPricingPreview(const [], const [], 100000, 'dibagi');
    expect(p.single.name, 'Biaya transport');
  });

  test('fromJson membaca angka string Decimal dari Nest', () {
    final d = ServicePricing.fromJson({
      'editable': true,
      'priced': true,
      'findingsSentAt': null,
      'invoice': {'id': 'i1', 'number': 'INV-1', 'status': 'belum_lunas', 'grandTotal': '350000', 'totalPaid': '0'},
      'lines': [
        {'serviceId': 's1', 'name': 'Cuci AC', 'qty': '2', 'unitPrice': '100000.00'},
      ],
      'transport': {'level': 2, 'mode': 'dibagi', 'amount': 200000},
      'sparepart': {
        'total': 150000,
        'requests': [
          {
            'amount': 150000,
            'used': true,
            'legacy': false,
            'items': [
              {'name': 'Pipa', 'qty': '4', 'qtyUsed': '2.5', 'unit': 'm', 'unitPrice': '50000'},
            ],
          },
        ],
      },
    });
    expect(d.lines.single.unitPrice, 100000);
    expect(d.transportLevel, 2);
    expect(d.transportMode, 'dibagi');
    expect(d.invoice!.grandTotal, 350000);
    expect(d.spareparts.single.items.single.qtyUsed, 2.5);
  });
}
