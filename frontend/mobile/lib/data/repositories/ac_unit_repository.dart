import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../models/ac_unit.dart';

/// Kontrak akses unit AC (tabel `member_ac_units`).
/// Tidak ada delete: unit dinonaktifkan lewat status `nonaktif`.
abstract interface class AcUnitRepository {
  Stream<List<AcUnit>> watchByMember(String memberId);
  Future<AcUnit?> findByBarcode(String value);

  /// Satu unit by id — dipakai layar riwayat service yang bisa dibuka tanpa
  /// membawa objek unit (mis. dari detail job atau deep-link).
  Future<AcUnit?> findById(String id);
  Future<String> create(AcUnit u);
  Future<void> update(String id, AcUnit u);
}

/// Konversi body JSON Nest (`GET /ac-units/lookup/:x` & `GET /ac-units/:id`,
/// keduanya membungkus unit sebagai `{ unit, member, activeJob,
/// serviceHistory }`) ke bentuk snake_case yang dipahami [AcUnit.fromMap].
///
/// `pk` sengaja di-`num.tryParse` dulu: kolom itu `Decimal` di Prisma, dan
/// `Decimal.toJSON()` mengembalikan STRING (mis. `"1.5"`), bukan number —
/// dicek langsung lewat `@prisma/client/runtime/client.js` di sesi ini,
/// bukan tebakan. Cast `as num?` di `fromMap` akan meledak kalau nilainya
/// String mentah.
Map<String, dynamic> acUnitRowFromNest(Map<dynamic, dynamic> json) {
  return {
    'member_id': json['memberId'],
    'brand': json['brand'],
    'model': json['model'],
    'pk': num.tryParse('${json['pk']}') ?? 0,
    'room_location': json['roomLocation'],
    'barcode_value': json['barcodeValue'],
    'serial_number': json['serialNumber'],
    'installation_date': json['installationDate'],
    'last_service_date': json['lastServiceDate'],
    'next_service_date': json['nextServiceDate'],
    'service_interval_days': json['serviceIntervalDays'],
    'status': json['status'],
  };
}

/// Body POST untuk `CreateAcUnitDto` (Nest) dari satu [AcUnit] — dipakai form
/// "Tambah Unit AC". `status` ikut dikirim (DTO sekarang menerimanya, lihat
/// komentar `CreateAcUnitDto`) — pilihan admin di dropdown status TIDAK lagi
/// didiamkan seperti sebelumnya. `barcodeValue` SENGAJA tidak ikut — endpoint
/// ini tidak menggenerate barcode (lihat `NestAcUnitRepository.create`),
/// digenerate terpisah lewat RPC `generate_ac_unit_barcode` sesudahnya.
Map<String, dynamic> acUnitCreateBodyForNest(AcUnit u) => {
      'memberId': u.memberId,
      'brand': u.brand,
      'model': u.model,
      'pk': u.pk,
      'roomLocation': u.roomLocation,
      'serialNumber': u.serialNumber,
      'status': u.status.value,
    };

/// Body PATCH untuk `UpdateAcUnitDto` (Nest) dari satu [AcUnit].
///
/// Field tanggal null SENGAJA diomit (bukan dikirim `null`): service Nest
/// melakukan `new Date(installationDate)` hanya bila field-nya `!==
/// undefined` — kirim `null` eksplisit akan menghasilkan `new Date(null)` =
/// epoch 1970, BUKAN NULL di DB. Form unit ini tidak pernah benar-benar
/// mengubah tanggal servis (nilainya selalu dibawa apa adanya dari
/// `widget.initial`), jadi meng-omit saat null persis reproduksi perilaku
/// no-op lama. `memberId`/`barcodeValue` sengaja TIDAK ikut — itu identitas
/// unit, `UpdateAcUnitDto` juga tidak menerimanya (lihat komentar DTO-nya).
Map<String, dynamic> acUnitUpdateBodyForNest(AcUnit u) {
  final body = <String, dynamic>{
    'brand': u.brand,
    'model': u.model,
    'pk': u.pk,
    'roomLocation': u.roomLocation,
    'serialNumber': u.serialNumber,
    'status': u.status.value,
  };
  if (u.installationDate != null) {
    body['installationDate'] = u.installationDate!.toUtc().toIso8601String();
  }
  if (u.lastServiceDate != null) {
    body['lastServiceDate'] = u.lastServiceDate!.toUtc().toIso8601String();
  }
  if (u.nextServiceDate != null) {
    body['nextServiceDate'] = u.nextServiceDate!.toUtc().toIso8601String();
  }
  return body;
}

/// Implementasi [AcUnitRepository] lewat backend NestJS.
///
/// [watchByMember] dimuat sekali dari `GET /members/:id` (backend tidak
/// memancarkan event realtime untuk unit AC); pemanggil me-refetch lewat
/// `ref.invalidate(memberUnitsProvider(...))` setelah create/update.
///
/// [create] memakai `POST /ac-units`; backend selalu menggenerate barcode
/// dan menerapkan `status` pilihan admin sesudahnya.
class NestAcUnitRepository implements AcUnitRepository {
  NestAcUnitRepository(ApiClient api)
      : _get = api.get,
        _post = api.post,
        _patch = api.patch;

  /// Konstruktor uji: suntik langsung fungsi HTTP tanpa mem-fork [ApiClient].
  @visibleForTesting
  NestAcUnitRepository.forTest(this._get, this._post, this._patch);

  final Future<dynamic> Function(String path) _get;
  final Future<dynamic> Function(String path, {Object? body}) _post;
  final Future<dynamic> Function(String path, {Object? body}) _patch;

  static const _path = '/ac-units';

  @override
  Stream<List<AcUnit>> watchByMember(String memberId) async* {
    final member = await _get('/members/${Uri.encodeComponent(memberId)}') as Map;
    yield [
      for (final u in member['acUnits'] as List)
        AcUnit.fromMap((u as Map)['id'] as String, acUnitRowFromNest(u)),
    ];
  }

  @override
  Future<String> create(AcUnit u) async {
    final json = await _post(_path, body: acUnitCreateBodyForNest(u)) as Map;
    return json['id'] as String;
  }

  @override
  Future<AcUnit?> findByBarcode(String value) =>
      _fetchUnit('$_path/lookup/${Uri.encodeComponent(value)}');

  @override
  Future<AcUnit?> findById(String id) => _fetchUnit('$_path/$id');

  /// `GET /ac-units/lookup/:x` & `GET /ac-units/:id` sama-sama membalas
  /// bentuk kaya `{ unit, member, activeJob, serviceHistory }` — cuma
  /// `.unit` yang dipakai kedua caller ([findByBarcode]/[findById]) di
  /// Flutter, jadi diambil bagian itu saja alih-alih memaksa
  /// [AcUnitRepository] membawa bentuk kaya ini ke seluruh app.
  Future<AcUnit?> _fetchUnit(String path) async {
    try {
      final json = await _get(path) as Map;
      final unit = json['unit'] as Map;
      return AcUnit.fromMap(unit['id'] as String, acUnitRowFromNest(unit));
    } on NestApiException catch (e) {
      if (e.statusCode == 404) return null;
      rethrow;
    }
  }

  /// CATATAN: `UpdateAcUnitDto.status` cuma menerima 3 dari 5 nilai enum
  /// Postgres `ac_unit_status` yang beneran ada (`menunggu_pemasangan`,
  /// `aktif`, `dalam_maintenance` — tidak ada `rusak`/`nonaktif`, lihat
  /// `@IsIn` di DTO-nya vs `enum AcUnitStatus` di schema.prisma). Form edit
  /// unit di Flutter membiarkan admin pilih kelima status itu. Set ke
  /// `rusak`/`nonaktif` lewat Nest akan gagal dengan error 400 yang
  /// KELIHATAN (bukan diam-diam salah), beda dari blokir [create] di atas —
  /// tetap dimigrasi, tapi ini bug DTO Nest yang nyata, dicatat di laporan,
  /// BUKAN ditambal di sini (di luar scope: tidak boleh ubah file Nest untuk
  /// ini).
  @override
  Future<void> update(String id, AcUnit u) async {
    await _patch('$_path/$id', body: acUnitUpdateBodyForNest(u));
  }
}
