import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/features/scan/unit_data_actions.dart';
import 'package:flutter_test/flutter_test.dart';

AcUnit _unit() => const AcUnit(
      id: 'u1',
      memberId: 'm1',
      brand: 'Daikin',
      model: 'X1',
      pk: 1.5,
      roomLocation: 'Kamar',
      serialNumber: 'SN1',
      status: AcUnitStatus.aktif,
    );

Map<String, dynamic>? _payload({
  String brand = 'Daikin',
  String model = 'X1',
  String pk = '1.5',
  String room = 'Kamar',
  String serial = 'SN1',
  String note = '',
}) =>
    buildCorrectionPayload(_unit(),
        brand: brand, model: model, pk: pk, room: room, serial: serial, note: note);

void main() {
  group('buildCorrectionPayload', () {
    test('tidak ada yang berubah -> null (tidak boleh kirim koreksi kosong)', () {
      expect(_payload(), isNull);
      expect(_payload(note: 'catatan saja'), isNull);
    });

    test('hanya kolom yang berubah yang ikut, plus catatan', () {
      final p = _payload(brand: ' LG ', room: 'Kantor', note: ' salah input ');
      expect(p, {'brand': 'LG', 'roomLocation': 'Kantor', 'note': 'salah input'});
    });

    test('PK koma desimal diparse; PK sama (1,5 vs 1.5) tidak dianggap berubah', () {
      expect(_payload(pk: '1,5'), isNull);
      expect(_payload(pk: '2'), {'pk': 2.0});
    });

    test('PK tidak valid diabaikan (bukan dikirim sebagai NaN)', () {
      expect(_payload(pk: 'abc'), isNull);
    });

    test('nomor seri dikosongkan dihitung sebagai perubahan', () {
      expect(_payload(serial: ''), {'serialNumber': ''});
    });
  });

  test('status menunggu_data dikenali (bukan jatuh ke menunggu_pemasangan)', () {
    expect(AcUnitStatus.fromValue('menunggu_data'), AcUnitStatus.menungguData);
    expect(AcUnitStatus.menungguData.label, 'Menunggu Data');
  });
}
