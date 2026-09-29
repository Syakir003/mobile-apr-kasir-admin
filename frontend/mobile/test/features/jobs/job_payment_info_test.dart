import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('order.invoice (Decimal string dari Nest) -> info bayar + sisa tagihan', () {
    final info = jobPaymentInfoFromJobDetail({
      'order': {
        'invoice': {'id': 'inv1', 'number': 'INV-1', 'status': 'dp', 'grandTotal': '3441000', 'totalPaid': '1000000'},
      },
    });
    expect(info.hasInvoice, isTrue);
    expect(info.number, 'INV-1');
    expect(info.status, InvoiceStatus.fromValue('dp'));
    expect(info.grandTotal, 3441000);
    expect(info.outstanding, 2441000);
  });

  test('lebih bayar -> sisa 0 (tidak negatif), sama seperti RPC', () {
    final info = jobPaymentInfoFromJobDetail({
      'order': {
        'invoice': {'id': 'i', 'number': 'N', 'status': 'lunas', 'grandTotal': 100, 'totalPaid': 150},
      },
    });
    expect(info.outstanding, 0);
  });

  test('job tanpa order/invoice -> hasInvoice false', () {
    expect(jobPaymentInfoFromJobDetail({'order': null}).hasInvoice, isFalse);
    expect(jobPaymentInfoFromJobDetail({'order': {'invoice': null}}).hasInvoice, isFalse);
  });
}
