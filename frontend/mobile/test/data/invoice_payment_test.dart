import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/data/models/manual_payment.dart';

import '../support/fake_invoice_repository.dart';

void main() {
  group('Invoice', () {
    test('roundtrip fromMap/toMap lengkap termasuk items[]', () {
      final inv = Invoice(
        id: 'inv1',
        number: 'INV-20260712-0001',
        transactionId: 'trx1',
        memberId: 'm1',
        customerName: 'Budi Santoso',
        customerPhone: '+6281234567890',
        items: const [
          InvoiceItem(
            kind: 'product',
            refId: 'p1',
            name: 'AC Daikin 1PK',
            unit: 'unit',
            qty: 1,
            unitPrice: 3500000,
            lineTotal: 3500000,
          ),
          InvoiceItem(
            kind: 'sparepart',
            refId: 'sp1',
            name: 'Freon R32',
            unit: 'kg',
            qty: 0.5,
            unitPrice: 150000,
            lineTotal: 75000,
          ),
        ],
        subtotal: 3575000,
        discount: 75000,
        taxPercent: 11,
        taxAmount: 385000,
        transportFee: 50000,
        grandTotal: 3935000,
        totalPaid: 1000000,
        status: InvoiceStatus.dp,
        notes: 'Pasang besok pagi',
        createdAt: DateTime(2026, 7, 12),
      );
      final map = inv.toMap();
      expect(map.containsKey('id'), isFalse,
          reason: 'toMap tidak boleh memuat id');
      expect(map['status'], 'dp');
      expect((map['items'] as List).length, 2);

      final back = Invoice.fromMap('inv1', map);
      expect(back.id, 'inv1');
      expect(back.number, inv.number);
      expect(back.transactionId, inv.transactionId);
      expect(back.memberId, inv.memberId);
      expect(back.customerName, inv.customerName);
      expect(back.customerPhone, inv.customerPhone);
      expect(back.items.length, 2);
      expect(back.items[0].kind, 'product');
      expect(back.items[0].refId, 'p1');
      expect(back.items[0].name, 'AC Daikin 1PK');
      expect(back.items[0].unit, 'unit');
      expect(back.items[0].qty, 1);
      expect(back.items[0].unitPrice, 3500000);
      expect(back.items[0].lineTotal, 3500000);
      expect(back.items[1].kind, 'sparepart');
      expect(back.items[1].qty, 0.5);
      expect(back.items[1].unitPrice, 150000);
      expect(back.items[1].lineTotal, 75000);
      expect(back.subtotal, 3575000);
      expect(back.discount, 75000);
      expect(back.taxPercent, 11.0);
      expect(back.taxAmount, 385000);
      expect(back.transportFee, 50000);
      expect(back.grandTotal, 3935000);
      expect(back.totalPaid, 1000000);
      expect(back.status, InvoiceStatus.dp);
      expect(back.notes, inv.notes);
      expect(back.createdAt, DateTime(2026, 7, 12));
      expect(back.sisa, 3935000 - 1000000);
    });

    test('default: status belum_dibayar, totalPaid 0, dan sisa', () {
      const inv = Invoice(
        number: 'INV-20260712-0002',
        transactionId: 'trx2',
        memberId: 'm2',
        customerName: 'Siti',
        customerPhone: '+6281200000000',
        subtotal: 1000000,
        grandTotal: 1000000,
      );
      expect(inv.id, '');
      expect(inv.items, isEmpty);
      expect(inv.discount, 0);
      expect(inv.taxAmount, 0);
      expect(inv.transportFee, 0);
      expect(inv.status, InvoiceStatus.belumDibayar);
      expect(inv.totalPaid, 0);
      expect(inv.notes, isNull);
      expect(inv.createdAt, isNull);
      expect(inv.sisa, 1000000);

      final back = Invoice.fromMap('gen', inv.toMap());
      expect(back.status, InvoiceStatus.belumDibayar);
      expect(back.totalPaid, 0);
      expect(back.items, isEmpty);
      expect(back.createdAt, isNull);
      expect(back.sisa, 1000000);
    });
  });

  group('ManualPayment', () {
    test('roundtrip fromMap/toMap', () {
      final p = ManualPayment(
        id: 'pay1',
        invoiceId: 'inv1',
        method: PaymentMethod.transfer,
        amount: 500000,
        note: 'Transfer BCA',
        proofUrl: 'https://example.com/proof.jpg',
        createdBy: 'uid-kasir-1',
        createdAt: DateTime(2026, 7, 12, 10, 30),
      );
      final map = p.toMap();
      expect(map.containsKey('id'), isFalse,
          reason: 'toMap tidak boleh memuat id');
      expect(map['method'], 'transfer');

      final back = ManualPayment.fromMap('pay1', map);
      expect(back.id, 'pay1');
      expect(back.invoiceId, 'inv1');
      expect(back.method, PaymentMethod.transfer);
      expect(back.amount, 500000);
      expect(back.cashReceived, isNull);
      expect(back.change, 0);
      expect(back.note, 'Transfer BCA');
      expect(back.proofUrl, 'https://example.com/proof.jpg');
      expect(back.createdBy, 'uid-kasir-1');
      expect(back.createdAt, DateTime(2026, 7, 12, 10, 30));
    });

    test('tunai lebih: cashReceived tersimpan, change = selisih', () {
      const p = ManualPayment(
        invoiceId: 'inv1',
        method: PaymentMethod.tunai,
        amount: 80000,
        cashReceived: 100000,
        createdBy: 'uid-kasir-1',
      );
      expect(p.change, 20000);
      final back = ManualPayment.fromMap('gen', p.toMap());
      expect(back.cashReceived, 100000);
      expect(back.change, 20000);
    });

    test('cashReceived == amount: tak dianggap kembalian', () {
      const p = ManualPayment(
        invoiceId: 'inv1',
        method: PaymentMethod.tunai,
        amount: 50000,
        cashReceived: 50000,
        createdBy: 'u1',
      );
      expect(p.change, 0);
    });

    test('default: cashReceived, note, proofUrl, createdAt null', () {
      const p = ManualPayment(
        invoiceId: 'inv1',
        method: PaymentMethod.tunai,
        amount: 200000,
        createdBy: 'uid-kasir-1',
      );
      expect(p.id, '');
      expect(p.cashReceived, isNull);
      expect(p.change, 0);
      expect(p.note, isNull);
      expect(p.proofUrl, isNull);
      expect(p.createdAt, isNull);
      final back = ManualPayment.fromMap('gen', p.toMap());
      expect(back.cashReceived, isNull);
      expect(back.note, isNull);
      expect(back.proofUrl, isNull);
      expect(back.createdAt, isNull);
    });
  });

  group('enum', () {
    test('InvoiceStatus & PaymentMethod: value/label lengkap + fromValue fallback', () {
      expect(InvoiceStatus.belumDibayar.value, 'belum_dibayar');
      expect(InvoiceStatus.belumDibayar.label, 'Belum Dibayar');
      expect(InvoiceStatus.dp.value, 'dp');
      expect(InvoiceStatus.dp.label, 'DP');
      expect(InvoiceStatus.kurangBayar.value, 'kurang_bayar');
      expect(InvoiceStatus.kurangBayar.label, 'Kurang Bayar');
      expect(InvoiceStatus.lunas.value, 'lunas');
      expect(InvoiceStatus.lunas.label, 'Lunas');
      expect(InvoiceStatus.refund.value, 'refund');
      expect(InvoiceStatus.refund.label, 'Refund');
      expect(InvoiceStatus.batal.value, 'batal');
      expect(InvoiceStatus.batal.label, 'Batal');
      expect(InvoiceStatus.fromValue('lunas'), InvoiceStatus.lunas);
      expect(InvoiceStatus.fromValue('tidak_dikenal'), InvoiceStatus.belumDibayar,
          reason: 'nilai tak dikenal jatuh ke default');

      expect(PaymentMethod.tunai.value, 'tunai');
      expect(PaymentMethod.tunai.label, 'Tunai');
      expect(PaymentMethod.transfer.value, 'transfer');
      expect(PaymentMethod.transfer.label, 'Transfer Bank');
      expect(PaymentMethod.qris.value, 'qris');
      expect(PaymentMethod.qris.label, 'QRIS Manual');
      expect(PaymentMethod.ewallet.value, 'ewallet');
      expect(PaymentMethod.ewallet.label, 'E-Wallet Manual');
      expect(PaymentMethod.fromValue('qris'), PaymentMethod.qris);
      expect(PaymentMethod.fromValue('tidak_dikenal'), PaymentMethod.tunai,
          reason: 'nilai tak dikenal jatuh ke default');
    });
  });

  group('FakeInvoiceRepository', () {
    test('watchPayments hanya emit milik invoice tsb', () async {
      final repo = FakeInvoiceRepository(
        invoices: [
          const MapEntry(
            'inv1',
            Invoice(
              number: 'INV-20260712-0001',
              transactionId: 'trx1',
              memberId: 'm1',
              customerName: 'Budi',
              customerPhone: '+6281234567890',
              subtotal: 100000,
              grandTotal: 100000,
            ),
          ),
        ],
        payments: [
          const MapEntry(
            'pay1',
            ManualPayment(
              invoiceId: 'inv1',
              method: PaymentMethod.tunai,
              amount: 50000,
              createdBy: 'u1',
            ),
          ),
          const MapEntry(
            'pay2',
            ManualPayment(
              invoiceId: 'inv2',
              method: PaymentMethod.transfer,
              amount: 200000,
              createdBy: 'u1',
            ),
          ),
        ],
      );
      final result = await repo.watchPayments('inv1').first;
      expect(result.map((p) => p.id), ['pay1']);
      expect(result.single.invoiceId, 'inv1');
      repo.dispose();
    });
  });
}
