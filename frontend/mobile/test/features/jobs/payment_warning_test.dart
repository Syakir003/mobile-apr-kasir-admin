import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/features/jobs/job_detail_screen.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:flutter_test/flutter_test.dart';

JobPaymentInfo _info({
  bool hasInvoice = true,
  InvoiceStatus status = InvoiceStatus.belumDibayar,
  int grandTotal = 500000,
  int totalPaid = 0,
}) =>
    (
      hasInvoice: hasInvoice,
      invoiceId: 'i1',
      number: 'INV-20260719-0001',
      status: status,
      grandTotal: grandTotal,
      totalPaid: totalPaid,
      outstanding: (grandTotal - totalPaid).clamp(0, grandTotal),
    );

void main() {
  group('paymentWarningFor', () {
    test('belum dibayar sama sekali: peringatan mendesak', () {
      final w = paymentWarningFor(_info());
      expect(w, isNotNull);
      expect(w!.judul, 'Tagihan belum dibayar');
      expect(w.mendesak, isTrue);
    });

    test('DP sebagian: peringatan biasa memakai label status invoice', () {
      final w = paymentWarningFor(
        _info(status: InvoiceStatus.dp, totalPaid: 200000),
      );
      expect(w, isNotNull);
      expect(w!.judul, 'Tagihan DP');
      expect(w.mendesak, isFalse);
    });

    test('kurang bayar tetap diperingatkan sampai lunas', () {
      final w = paymentWarningFor(
        _info(status: InvoiceStatus.kurangBayar, totalPaid: 450000),
      );
      expect(w!.judul, 'Tagihan Kurang Bayar');
      expect(w.mendesak, isFalse);
    });

    test('lunas: tidak ada peringatan', () {
      expect(
        paymentWarningFor(
          _info(status: InvoiceStatus.lunas, totalPaid: 500000),
        ),
        isNull,
      );
    });

    test('job order manual tanpa invoice: tidak ada peringatan', () {
      expect(paymentWarningFor(_info(hasInvoice: false)), isNull);
    });

    test('info belum termuat: tidak ada peringatan', () {
      expect(paymentWarningFor(null), isNull);
    });
  });
}
