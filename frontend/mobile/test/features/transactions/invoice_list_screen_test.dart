import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/features/transactions/invoice_list_screen.dart';
import 'package:flutter_test/flutter_test.dart';

Invoice _inv({
  required String id,
  String number = 'INV-20260806-0001',
  String customer = 'Budi',
  String phone = '081234567890',
  int grandTotal = 100000,
  int totalPaid = 0,
  InvoiceStatus status = InvoiceStatus.belumDibayar,
  DateTime? createdAt,
}) =>
    Invoice(
      id: id,
      number: number,
      transactionId: 't1',
      memberId: 'm1',
      customerName: customer,
      customerPhone: phone,
      subtotal: grandTotal,
      grandTotal: grandTotal,
      totalPaid: totalPaid,
      status: status,
      createdAt: createdAt,
    );

void main() {
  final now = DateTime(2026, 8, 6, 15, 0);

  group('filterInvoices', () {
    test('rentang "hari ini" dihitung dari tengah malam, bukan 24 jam mundur',
        () {
      final invoices = [
        _inv(id: 'pagi', createdAt: DateTime(2026, 8, 6, 1, 0)),
        _inv(id: 'kemarinMalam', createdAt: DateTime(2026, 8, 5, 23, 0)),
      ];
      final shown = filterInvoices(
        invoices,
        range: InvoiceRange.today,
        status: null,
        search: '',
        now: now,
      );
      // Transaksi jam 01:00 hari ini IKUT (24 jam mundur akan membuangnya),
      // transaksi 23:00 kemarin TIDAK.
      expect(shown.map((i) => i.id), ['pagi']);
    });

    test('rentang "semua" tidak membuang invoice tanpa tanggal', () {
      final invoices = [_inv(id: 'a', createdAt: null)];
      expect(
        filterInvoices(invoices,
                range: InvoiceRange.all, status: null, search: '', now: now)
            .length,
        1,
      );
    });

    test('invoice tanpa tanggal tersaring keluar pada rentang terbatas', () {
      final invoices = [_inv(id: 'a', createdAt: null)];
      expect(
        filterInvoices(invoices,
            range: InvoiceRange.week, status: null, search: '', now: now),
        isEmpty,
      );
    });

    test('menyaring per status', () {
      final invoices = [
        _inv(id: 'lunas', status: InvoiceStatus.lunas),
        _inv(id: 'belum', status: InvoiceStatus.belumDibayar),
      ];
      final shown = filterInvoices(
        invoices,
        range: InvoiceRange.all,
        status: InvoiceStatus.lunas,
        search: '',
        now: now,
      );
      expect(shown.map((i) => i.id), ['lunas']);
    });

    test('pencarian cocok pada nomor, nama, maupun nomor HP', () {
      final invoices = [
        _inv(id: 'a', number: 'INV-20260806-0007', customer: 'Siti'),
        _inv(id: 'b', number: 'INV-20260806-0008', customer: 'Budi',
            phone: '089900112233'),
      ];
      Iterable<String> ids(String q) => filterInvoices(invoices,
              range: InvoiceRange.all, status: null, search: q, now: now)
          .map((i) => i.id);

      expect(ids('0007'), ['a']);
      expect(ids('budi'), ['b'], reason: 'pencarian tidak peka huruf besar');
      expect(ids('8990'), ['b']);
      expect(ids('  '), ['a', 'b'], reason: 'spasi saja bukan kriteria');
    });
  });

  group('summarizeInvoices', () {
    test('menjumlahkan nilai, terbayar, dan piutang', () {
      final s = summarizeInvoices([
        _inv(id: 'a', grandTotal: 100000, totalPaid: 100000,
            status: InvoiceStatus.lunas),
        _inv(id: 'b', grandTotal: 200000, totalPaid: 50000,
            status: InvoiceStatus.dp),
      ]);
      expect(s.count, 2);
      expect(s.total, 300000);
      expect(s.paid, 150000);
      expect(s.outstanding, 150000);
    });

    test('invoice batal & refund tidak dihitung sebagai omzet', () {
      final s = summarizeInvoices([
        _inv(id: 'a', grandTotal: 100000, totalPaid: 100000,
            status: InvoiceStatus.lunas),
        _inv(id: 'batal', grandTotal: 500000, status: InvoiceStatus.batal),
        _inv(id: 'refund', grandTotal: 700000, totalPaid: 700000,
            status: InvoiceStatus.refund),
      ]);
      expect(s.count, 1);
      expect(s.total, 100000);
      expect(s.paid, 100000);
      expect(s.outstanding, 0);
    });

    test('lebih bayar tidak menghasilkan piutang negatif', () {
      final s = summarizeInvoices([
        _inv(id: 'a', grandTotal: 100000, totalPaid: 120000,
            status: InvoiceStatus.lunas),
        _inv(id: 'b', grandTotal: 100000, totalPaid: 40000,
            status: InvoiceStatus.kurangBayar),
      ]);
      // Kelebihan Rp 20.000 pada invoice pertama TIDAK boleh mengurangi sisa
      // tagihan invoice kedua.
      expect(s.outstanding, 60000);
    });

    test('daftar kosong menghasilkan nol, bukan error', () {
      final s = summarizeInvoices(const []);
      expect(s, (count: 0, total: 0, paid: 0, outstanding: 0));
    });
  });
}
