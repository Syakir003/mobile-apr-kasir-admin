import 'package:epos_ac/features/pos/cart_state.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('computeCartTotals (rumus identik functions/src/pos/totals.ts)', () {
    test('subtotal saja tanpa diskon/pajak/transport', () {
      const cart = Cart(
        lines: [
          CartLine(
            kind: CartItemKind.product,
            refId: 'p1',
            name: 'AC 1 PK',
            unit: 'unit',
            unitPrice: 10000,
            qty: 2,
          ),
        ],
      );
      final totals = computeCartTotals(cart);
      expect(totals.subtotal, 20000);
      expect(totals.taxAmount, 0);
      expect(totals.grandTotal, 20000);
    });

    test('diskon + pajak 11% + transport (transport TIDAK kena pajak)', () {
      // Subtotal: 1 x 100000 = 100000; diskon 10000 -> taxBase 90000
      // taxAmount = round(90000 * 11 / 100) = 9900
      // grandTotal = 90000 + 9900 + 5000 = 104900
      const cart = Cart(
        lines: [
          CartLine(
            kind: CartItemKind.product,
            refId: 'p1',
            name: 'AC 1 PK',
            unit: 'unit',
            unitPrice: 100000,
            qty: 1,
          ),
        ],
        discount: 10000,
        taxPercent: 11,
        transportFee: 5000,
      );
      final totals = computeCartTotals(cart);
      expect(totals.subtotal, 100000);
      expect(totals.taxAmount, 9900);
      expect(totals.grandTotal, 104900);
    });

    test('qty pecahan: 2.5 x 15000 = 37500', () {
      const cart = Cart(
        lines: [
          CartLine(
            kind: CartItemKind.sparepart,
            refId: 'sp1',
            name: 'Pipa Tembaga',
            unit: 'meter',
            unitPrice: 15000,
            qty: 2.5,
          ),
        ],
      );
      final totals = computeCartTotals(cart);
      expect(totals.subtotal, 37500);
      expect(totals.taxAmount, 0);
      expect(totals.grandTotal, 37500);
    });
  });

  test(
      'mergeCartLine menambah baris baru & menggabungkan qty saat kind+refId sama (dipakai CartNotifier.addLine)',
      () {
    const p1 = CartLine(
      kind: CartItemKind.product,
      refId: 'p1',
      name: 'AC 1 PK',
      unit: 'unit',
      unitPrice: 3000000,
      qty: 1,
    );
    var lines = mergeCartLine(const [], p1);
    expect(lines, hasLength(1));
    expect(lines.single.qty, 1);

    const p1Again = CartLine(
      kind: CartItemKind.product,
      refId: 'p1',
      name: 'AC 1 PK',
      unit: 'unit',
      unitPrice: 3000000,
      qty: 2,
    );
    lines = mergeCartLine(lines, p1Again);
    expect(lines, hasLength(1));
    expect(lines.single.qty, 3);

    const sp1 = CartLine(
      kind: CartItemKind.sparepart,
      refId: 'sp1',
      name: 'Pipa Tembaga',
      unit: 'meter',
      unitPrice: 15000,
      qty: 2.5,
    );
    lines = mergeCartLine(lines, sp1);
    expect(lines, hasLength(2));
    expect(lines[1].qty, 2.5);
  });

  test(
      'buildCheckoutPayload: phone dinormalisasi, installations 1 entri per unit qty (itemIndex sama), jasa tidak menghasilkan installations',
      () {
    const cart = Cart(
      customerName: 'Budi Santoso',
      customerPhone: '0812-3456-7890',
      customerAddress: 'Jl. Melati 3',
      discount: 5000,
      taxPercent: 11,
      transportFee: 10000,
      notes: 'Pasang pagi hari',
      lines: [
        CartLine(
          kind: CartItemKind.product,
          refId: 'p1',
          name: 'AC Split 1 PK',
          unit: 'unit',
          unitPrice: 3500000,
          qty: 2,
          withInstallation: true,
          roomLocation: 'Ruang tamu',
          technicianId: 't1',
        ),
        CartLine(
          kind: CartItemKind.service,
          refId: 's1',
          name: 'Cuci AC',
          unit: 'jasa',
          unitPrice: 75000,
          qty: 1,
        ),
      ],
    );

    final payload = buildCheckoutPayload(cart);

    expect(payload['customer'], {
      'name': 'Budi Santoso',
      'phone': '+6281234567890',
      'address': 'Jl. Melati 3',
    });
    expect(payload['items'], [
      {'kind': 'product', 'refId': 'p1', 'qty': 2},
      {'kind': 'service', 'refId': 's1', 'qty': 1},
    ]);
    expect(payload['discount'], 5000);
    expect(payload['taxPercent'], 11.0);
    expect(payload['transportFee'], 10000);
    expect(payload['notes'], 'Pasang pagi hari');

    final installations = payload['installations'] as List;
    expect(installations, hasLength(2));
    for (final inst in installations) {
      expect(inst, {
        'itemIndex': 0,
        'roomLocation': 'Ruang tamu',
        'technicianId': 't1',
      });
    }
    // Tanpa unit terpilih, serviceUnits dihilangkan dari payload.
    expect(payload.containsKey('serviceUnits'), isFalse);
  });

  test(
      'buildCheckoutPayload: unit jasa jadi serviceUnits (satu entri per unit, teknisi baris ikut)',
      () {
    const cart = Cart(
      customerName: 'Siti',
      customerPhone: '081200001111',
      lines: [
        CartLine(
          kind: CartItemKind.product,
          refId: 'p1',
          name: 'AC 1 PK',
          unit: 'unit',
          unitPrice: 3500000,
          qty: 1,
        ),
        CartLine(
          kind: CartItemKind.service,
          refId: 's1',
          name: 'Cuci AC',
          unit: 'jasa',
          unitPrice: 65000,
          qty: 2,
          technicianId: 't1',
          unitIds: ['u1', 'u2'],
        ),
        CartLine(
          kind: CartItemKind.service,
          refId: 's2',
          name: 'Isi Freon',
          unit: 'jasa',
          unitPrice: 120000,
          qty: 1,
          unitIds: ['u1'],
        ),
      ],
    );

    final payload = buildCheckoutPayload(cart);
    expect(payload['serviceUnits'], [
      {'itemIndex': 1, 'unitId': 'u1', 'technicianId': 't1'},
      {'itemIndex': 1, 'unitId': 'u2', 'technicianId': 't1'},
      {'itemIndex': 2, 'unitId': 'u1'},
    ]);
  });

  test('incompleteServiceLines: baris jasa yang unitnya kurang dari qty', () {
    const lengkap = CartLine(
      kind: CartItemKind.service,
      refId: 's1',
      name: 'Cuci AC',
      unit: 'jasa',
      unitPrice: 65000,
      qty: 2,
      unitIds: ['u1', 'u2'],
    );
    const kurang = CartLine(
      kind: CartItemKind.service,
      refId: 's2',
      name: 'Isi Freon',
      unit: 'jasa',
      unitPrice: 120000,
      qty: 2,
      unitIds: ['u1'],
    );
    const produk = CartLine(
      kind: CartItemKind.product,
      refId: 'p1',
      name: 'AC 1 PK',
      unit: 'unit',
      unitPrice: 3500000,
      qty: 3,
    );

    expect(incompleteServiceLines(const Cart(lines: [lengkap, produk])),
        isEmpty);
    expect(incompleteServiceLines(const Cart(lines: [lengkap, kurang])), [1]);
  });
}
