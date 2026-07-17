import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/models/member.dart';

void main() {
  group('Member', () {
    test('roundtrip fromMap/toMap lengkap', () {
      final m = Member(
        id: 'm1',
        name: 'Budi Santoso',
        phone: '+6281234567890',
        address: 'Jl. Melati 3',
        customerType: 'rumah',
        memberSince: DateTime(2026, 7, 6),
        totalAcUnits: 2,
        notes: 'langganan cuci rutin',
        active: true,
      );
      final map = m.toMap();
      expect(map.containsKey('id'), isFalse,
          reason: 'toMap tidak boleh memuat id');
      final back = Member.fromMap('m1', map);
      expect(back.id, 'm1');
      expect(back.name, m.name);
      expect(back.phone, m.phone);
      expect(back.address, m.address);
      expect(back.customerType, m.customerType);
      expect(back.memberSince, DateTime(2026, 7, 6));
      expect(back.totalAcUnits, 2);
      expect(back.notes, m.notes);
      expect(back.active, isTrue);
    });

    test('default: memberSince null, totalAcUnits 0, active true', () {
      const m = Member(name: 'X', phone: '+6281', address: '', customerType: 'lainnya');
      expect(m.id, '');
      expect(m.memberSince, isNull);
      expect(m.totalAcUnits, 0);
      expect(m.notes, isNull);
      expect(m.active, isTrue);
      final back = Member.fromMap('gen', m.toMap());
      expect(back.memberSince, isNull);
      expect(back.totalAcUnits, 0);
      expect(back.notes, isNull);
    });

    test('kCustomerTypes berisi lima jenis pelanggan', () {
      expect(kCustomerTypes,
          ['rumah', 'kantor', 'toko', 'perusahaan', 'lainnya']);
    });
  });

  group('AcUnit', () {
    test('roundtrip fromMap/toMap lengkap', () {
      final u = AcUnit(
        id: 'u1',
        memberId: 'm1',
        brand: 'Daikin',
        model: 'FTV-25',
        pk: 1.5,
        roomLocation: 'Kamar utama',
        barcodeValue: 'ACUNIT-20260706-0001',
        serialNumber: 'SN123',
        installationDate: DateTime(2026, 7, 6),
        lastServiceDate: DateTime(2026, 7, 7),
        nextServiceDate: DateTime(2026, 10, 6),
        status: AcUnitStatus.aktif,
      );
      final map = u.toMap();
      expect(map.containsKey('id'), isFalse,
          reason: 'toMap tidak boleh memuat id');
      expect(map['status'], 'aktif');
      final back = AcUnit.fromMap('u1', map);
      expect(back.id, 'u1');
      expect(back.memberId, 'm1');
      expect(back.brand, u.brand);
      expect(back.model, u.model);
      expect(back.pk, 1.5);
      expect(back.roomLocation, u.roomLocation);
      expect(back.barcodeValue, u.barcodeValue);
      expect(back.serialNumber, 'SN123');
      expect(back.installationDate, DateTime(2026, 7, 6));
      expect(back.lastServiceDate, DateTime(2026, 7, 7));
      expect(back.nextServiceDate, DateTime(2026, 10, 6));
      expect(back.status, AcUnitStatus.aktif);
    });

    test('default: barcode kosong, status menunggu pemasangan, tanggal null', () {
      const u = AcUnit(
        memberId: 'm1',
        brand: 'Sharp',
        model: 'AH-X9',
        pk: 0.5,
        roomLocation: 'Ruang tamu',
      );
      expect(u.id, '');
      expect(u.barcodeValue, '');
      expect(u.serialNumber, isNull);
      expect(u.status, AcUnitStatus.menungguPemasangan);
      final back = AcUnit.fromMap('gen', u.toMap());
      expect(back.barcodeValue, '');
      expect(back.installationDate, isNull);
      expect(back.lastServiceDate, isNull);
      expect(back.nextServiceDate, isNull);
      expect(back.status, AcUnitStatus.menungguPemasangan);
    });

    test('AcUnitStatus nilai snake_case dan label Indonesia', () {
      expect(AcUnitStatus.menungguPemasangan.value, 'menunggu_pemasangan');
      expect(AcUnitStatus.dalamMaintenance.value, 'dalam_maintenance');
      expect(AcUnitStatus.fromValue('rusak'), AcUnitStatus.rusak);
      expect(AcUnitStatus.fromValue('nonaktif'), AcUnitStatus.nonaktif);
      expect(AcUnitStatus.fromValue('tidak_dikenal'),
          AcUnitStatus.menungguPemasangan,
          reason: 'nilai tak dikenal jatuh ke default');
      expect(AcUnitStatus.aktif.label, 'Aktif');
      expect(AcUnitStatus.menungguPemasangan.label, 'Menunggu Pemasangan');
    });
  });
}
