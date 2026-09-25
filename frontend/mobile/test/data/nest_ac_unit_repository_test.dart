import 'package:epos_ac/core/api/api_client.dart';
import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/repositories/ac_unit_repository.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_ac_unit_repository.dart';

/// Body `{ unit, member, activeJob, serviceHistory }` seperti dibalas
/// `GET /ac-units/lookup/:x` & `GET /ac-units/:id` — `pk` sengaja string,
/// meniru `Decimal.toJSON()` Prisma (dicek langsung di sesi migrasi ini).
Map<String, dynamic> _nestDetailBody({String pk = '1.5', String? barcode}) => {
      'unit': {
        'id': 'u1',
        'memberId': 'm1',
        'brand': 'Daikin',
        'model': 'FTV-25',
        'pk': pk,
        'roomLocation': 'Kamar',
        'barcodeValue': barcode,
        'serialNumber': null,
        'installationDate': null,
        'lastServiceDate': null,
        'nextServiceDate': null,
        'serviceIntervalDays': null,
        'status': 'aktif',
      },
      'member': {'id': 'm1'},
      'activeJob': null,
      'serviceHistory': <dynamic>[],
    };

AcUnit _unit({
  String memberId = 'm1',
  double pk = 1,
  String? serialNumber,
  DateTime? installationDate,
  AcUnitStatus status = AcUnitStatus.aktif,
}) =>
    AcUnit(
      memberId: memberId,
      brand: 'Daikin',
      model: 'FTV-25',
      pk: pk,
      roomLocation: 'Kamar',
      serialNumber: serialNumber,
      installationDate: installationDate,
      status: status,
    );

void main() {
  group('acUnitRowFromNest (pure mapping)', () {
    test('konversi camelCase Nest -> snake_case fromMap, pk string->num', () {
      final row = acUnitRowFromNest(_nestDetailBody(pk: '2')['unit'] as Map);
      final unit = AcUnit.fromMap('u1', row);
      expect(unit.memberId, 'm1');
      expect(unit.pk, 2);
      expect(unit.roomLocation, 'Kamar');
      expect(unit.status, AcUnitStatus.aktif);
    });
  });

  group('acUnitCreateBodyForNest (pure mapping)', () {
    test('field dipetakan, status ikut, barcodeValue TIDAK ikut', () {
      final body = acUnitCreateBodyForNest(_unit(status: AcUnitStatus.menungguPemasangan));
      expect(body['memberId'], 'm1');
      expect(body['brand'], 'Daikin');
      expect(body['status'], 'menunggu_pemasangan');
      expect(body.containsKey('barcodeValue'), isFalse);
    });
  });

  group('acUnitUpdateBodyForNest (pure mapping)', () {
    test('tanggal null diomit, bukan dikirim null', () {
      final body = acUnitUpdateBodyForNest(_unit());
      expect(body.containsKey('installationDate'), isFalse);
      expect(body['brand'], 'Daikin');
      expect(body['status'], 'aktif');
    });

    test('tanggal terisi dikirim sebagai ISO string', () {
      final date = DateTime.utc(2026, 1, 1);
      final body = acUnitUpdateBodyForNest(_unit(installationDate: date));
      expect(body['installationDate'], date.toIso8601String());
    });

    test('memberId/barcodeValue tidak ikut (identitas unit)', () {
      final body = acUnitUpdateBodyForNest(_unit());
      expect(body.containsKey('memberId'), isFalse);
      expect(body.containsKey('barcodeValue'), isFalse);
    });
  });

  group('NestAcUnitRepository', () {
    test('findByBarcode: respons sukses di-unwrap dari .unit', () async {
      final repo = NestAcUnitRepository.forTest(
        (path) async {
          expect(path, '/ac-units/lookup/ACUNIT-1');
          return _nestDetailBody(barcode: 'ACUNIT-1');
        },
        (path, {body}) async => null,
        (path, {body}) async => null,
        FakeAcUnitRepository(),
      );
      final unit = await repo.findByBarcode('ACUNIT-1');
      expect(unit?.brand, 'Daikin');
      expect(unit?.barcodeValue, 'ACUNIT-1');
    });

    test('findById: 404 dari Nest jadi null (bukan exception)', () async {
      final repo = NestAcUnitRepository.forTest(
        (path) async => throw NestApiException(404, 'Unit AC tidak ditemukan'),
        (path, {body}) async => null,
        (path, {body}) async => null,
        FakeAcUnitRepository(),
      );
      expect(await repo.findById('tidak-ada'), isNull);
    });

    test('findById: error selain 404 diteruskan (bukan diredam)', () async {
      final repo = NestAcUnitRepository.forTest(
        (path) async => throw NestApiException(500, 'Server error'),
        (path, {body}) async => null,
        (path, {body}) async => null,
        FakeAcUnitRepository(),
      );
      expect(
        () => repo.findById('u1'),
        throwsA(isA<NestApiException>().having((e) => e.statusCode, 'statusCode', 500)),
      );
    });

    test('token kedaluwarsa/tak login (401) diteruskan sebagai NestApiException', () async {
      final repo = NestAcUnitRepository.forTest(
        (path) async => throw NestApiException(401, 'Belum login.'),
        (path, {body}) async => null,
        (path, {body}) async => null,
        FakeAcUnitRepository(),
      );
      expect(
        () => repo.findByBarcode('X'),
        throwsA(isA<NestApiException>().having((e) => e.statusCode, 'statusCode', 401)),
      );
    });

    test('update: memanggil PATCH /ac-units/:id dengan body yang sudah dipetakan', () async {
      String? calledPath;
      Object? calledBody;
      final repo = NestAcUnitRepository.forTest(
        (path) async => null,
        (path, {body}) async => null,
        (path, {body}) async {
          calledPath = path;
          calledBody = body;
        },
        FakeAcUnitRepository(),
      );
      await repo.update('u1', _unit(serialNumber: 'SN-1'));
      expect(calledPath, '/ac-units/u1');
      expect((calledBody as Map)['serialNumber'], 'SN-1');
    });

    test('create: memanggil POST /ac-units dengan body yang sudah dipetakan (bukan fallback)', () async {
      String? calledPath;
      Object? calledBody;
      final fallback = FakeAcUnitRepository();
      final repo = NestAcUnitRepository.forTest(
        (path) async => null,
        (path, {body}) async {
          calledPath = path;
          calledBody = body;
          return {'id': 'u-baru'};
        },
        (path, {body}) async => null,
        fallback,
      );
      final id = await repo.create(_unit(status: AcUnitStatus.aktif));
      expect(calledPath, '/ac-units');
      expect((calledBody as Map)['status'], 'aktif');
      expect(id, 'u-baru');
      expect(fallback.created, isEmpty); // TIDAK lagi lewat fallback
    });

    test('watchByMember tetap didelegasikan ke fallback (Realtime Supabase)', () async {
      final fallback = FakeAcUnitRepository();
      final repo = NestAcUnitRepository.forTest(
        (path) async => null,
        (path, {body}) async => null,
        (path, {body}) async => null,
        fallback,
      );
      final id = await fallback.create(_unit());

      final stream = repo.watchByMember('m1');
      final first = await stream.first;
      expect(first.single.id, id);
      fallback.dispose();
    });
  });
}
