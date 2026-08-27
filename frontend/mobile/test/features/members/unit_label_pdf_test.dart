import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/features/members/unit_label_pdf.dart';

AcUnit _unit({String barcode = 'ACUNIT-20260715-0001'}) => AcUnit(
      id: 'unit-1',
      memberId: 'mbr-1',
      brand: 'Daikin',
      model: 'FTKC-15 1 PK Inverter',
      pk: 1,
      roomLocation: 'Kamar Utama',
      barcodeValue: barcode,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('label unit berhasil dibangun', () async {
    final bytes = await buildUnitLabelPdf(_unit());
    expect(bytes.length, greaterThan(1000));
  });

  // Code 128 harus bisa meng-encode format barcode_value dari RPC
  // (`ACUNIT-` + tanggal + urutan). Simbologi yang salah pilih akan
  // melempar saat PDF dibangun, bukan diam-diam.
  test('barcode value dari RPC ter-encode tanpa error', () async {
    final bytes =
        await buildUnitLabelPdf(_unit(barcode: 'ACUNIT-20261231-9999'));
    expect(bytes.length, greaterThan(1000));
  });
}
