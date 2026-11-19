import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/features/transactions/receipt_escpos.dart';
import 'package:flutter_test/flutter_test.dart';

Invoice _invoice({int paid = 0, InvoiceStatus status = InvoiceStatus.belumDibayar}) => Invoice(
      id: 'i1',
      number: 'INV-001',
      transactionId: 't',
      memberId: 'm',
      customerName: 'Budi Santoso',
      customerPhone: '0812',
      items: const [
        InvoiceItem(
          kind: 'product',
          refId: 'p',
          name: 'AC Split Daikin 1 PK Inverter Type FTKC25',
          unit: 'unit',
          qty: 2,
          unitPrice: 4500000,
          lineTotal: 9000000,
        ),
      ],
      subtotal: 9000000,
      discount: 100000,
      taxPercent: 11,
      taxAmount: 979000,
      transportFee: 50000,
      grandTotal: 9929000,
      totalPaid: paid,
      status: status,
      notes: 'Pasang hari Sabtu',
      createdAt: DateTime(2026, 11, 19, 9, 5),
    );

String _text(List<int> b) => String.fromCharCodes(b);

void main() {
  test('ascii membuang aksen dan simbol non-ASCII', () {
    expect(ascii('Café • Ñandú — Ünit'), 'Cafe - Nandu - Unit');
  });

  test('wrap dan pair tidak pernah melebihi 32 kolom', () {
    for (final l in wrap('Jl. Gunung Anyar Rt 01 Rw 06 Kelurahan Gunung Gedangan Mojokerto Sangat-Panjang-Sekali-Kata-Tanpa-Spasi')) {
      expect(l.length, lessThanOrEqualTo(32));
    }
    expect(pair('TOTAL', 'Rp 9.929.000'), ['TOTAL${' ' * 15}Rp 9.929.000']);
    for (final l in pair('Nama pelanggan yang sangat panjang sekali ya', 'Rp 9.929.000')) {
      expect(l.length, lessThanOrEqualTo(32));
    }
  });

  test('struk belum lunas: init, judul, rincian, sisa tagihan, dan tidak ada baris lebih dari 32 kolom', () {
    final bytes = buildReceiptBytes(ReceiptEscPos.fromInvoice(_invoice(paid: 2000000, status: InvoiceStatus.dp), address: 'Jl. Mawar 1'));
    expect(bytes.take(2), [0x1b, 0x40]);
    final t = _text(bytes);
    expect(t, contains('AYUB AC'));
    expect(t, contains('INV-001'));
    expect(t, contains('19-11-2026 09:05'));
    expect(t, contains('Alamat: Jl. Mawar 1'));
    expect(t, contains('Diskon'));
    expect(t, contains('- Rp 100.000'));
    expect(t, contains('Pajak (11%)'));
    expect(t, contains('Biaya transport'));
    expect(t, contains('DP'));
    expect(t, contains('SISA TAGIHAN'));
    expect(t, contains('Rp 7.929.000'));
    expect(t, isNot(contains('LUNAS')));
    expect(t, contains('Catatan: Pasang hari Sabtu'));
    // Hanya baris teks (tanpa kode kendali) yang diukur.
    for (final line in t.split('\n')) {
      final printable = line.replaceAll(RegExp(r'[\x00-\x1f]'), '');
      expect(printable.length, lessThanOrEqualTo(32 + 3), reason: line); // + sisa parameter perintah ESC/GS
    }
  });

  test('struk lunas menampilkan *** LUNAS *** tanpa sisa tagihan', () {
    final t = _text(buildReceiptBytes(ReceiptEscPos.fromInvoice(_invoice(paid: 9929000, status: InvoiceStatus.lunas))));
    expect(t, contains('*** LUNAS ***'));
    expect(t, isNot(contains('SISA TAGIHAN')));
  });
}
