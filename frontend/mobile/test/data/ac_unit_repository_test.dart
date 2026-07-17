import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_ac_unit_repository.dart';

AcUnit _unit({String memberId = 'm1', String barcode = ''}) => AcUnit(
      memberId: memberId,
      brand: 'Daikin',
      model: 'FTV-25',
      pk: 1,
      roomLocation: 'Kamar',
      barcodeValue: barcode,
    );

void main() {
  group('FakeAcUnitRepository', () {
    test('watchByMember hanya emit unit milik member tersebut', () async {
      final repo = FakeAcUnitRepository(seed: [
        MapEntry('u1', _unit(memberId: 'm1')),
        MapEntry('u2', _unit(memberId: 'm2')),
      ]);
      final first = await repo.watchByMember('m1').first;
      expect(first.map((u) => u.id), ['u1']);
      repo.dispose();
    });

    test('findByBarcode menemukan unit atau null bila tidak ada', () async {
      final repo = FakeAcUnitRepository(seed: [
        MapEntry('u1', _unit(barcode: 'ACUNIT-20260706-0001')),
      ]);
      final found = await repo.findByBarcode('ACUNIT-20260706-0001');
      expect(found?.id, 'u1');
      expect(await repo.findByBarcode('TIDAK-ADA'), isNull);
      repo.dispose();
    });

    test('create memberi id, tercatat, dan muncul di items', () async {
      final repo = FakeAcUnitRepository();
      final id = await repo.create(_unit());
      expect(id, isNotEmpty);
      expect(repo.created, hasLength(1));
      expect(repo.items.single.id, id);
      repo.dispose();
    });
  });
}
