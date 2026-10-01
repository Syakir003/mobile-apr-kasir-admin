import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

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

/// Implementasi [AcUnitRepository] di atas Supabase.
class SupabaseAcUnitRepository implements AcUnitRepository {
  SupabaseAcUnitRepository(this._client);

  final SupabaseClient _client;

  static const _table = 'member_ac_units';

  @override
  Stream<List<AcUnit>> watchByMember(String memberId) {
    return _client
        .from(_table)
        .stream(primaryKey: ['id'])
        .eq('member_id', memberId)
        .map(
          (rows) => rows
              .map((row) => AcUnit.fromMap(row['id'] as String, row))
              .toList(growable: false),
        );
  }

  @override
  Future<AcUnit?> findByBarcode(String value) async {
    final row = await _client
        .from(_table)
        .select()
        .eq('barcode_value', value)
        .limit(1)
        .maybeSingle();
    if (row == null) return null;
    return AcUnit.fromMap(row['id'] as String, row);
  }

  @override
  Future<AcUnit?> findById(String id) async {
    final row =
        await _client.from(_table).select().eq('id', id).maybeSingle();
    if (row == null) return null;
    return AcUnit.fromMap(row['id'] as String, row);
  }

  @override
  Future<String> create(AcUnit u) async {
    final row =
        await _client.from(_table).insert(_toRow(u)).select('id').single();
    return row['id'] as String;
  }

  @override
  Future<void> update(String id, AcUnit u) =>
      _client.from(_table).update(_toRow(u)).eq('id', id);

  /// `barcode_value` kosong disimpan NULL supaya UNIQUE constraint tidak
  /// menabrak antar unit yang belum punya barcode.
  static Map<String, dynamic> _toRow(AcUnit u) {
    final row = u.toMap();
    if ((row['barcode_value'] as String).isEmpty) row['barcode_value'] = null;
    return row;
  }
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

/// Implementasi [AcUnitRepository] lewat backend NestJS — pengganti
/// [SupabaseAcUnitRepository] pada migrasi Flutter -> Nest (dibiarkan ada di
/// atas untuk rollback cepat).
///
/// TIDAK semuanya pindah:
/// - [watchByMember] tetap Supabase Realtime (`.stream(...)`) — prinsip sesi
///   ini: realtime belum ada penggantinya di Nest, jangan diubah jadi
///   one-shot diam-diam. Didelegasikan ke [_fallback] (instance
///   [SupabaseAcUnitRepository] asli lewat konstruktor utama, atau apa pun
///   yang disuntik lewat [NestAcUnitRepository.forTest]).
///
/// [create] SEKARANG pindah ke `POST /ac-units` — dua blokir lamanya sudah
/// ditambal di backend (`CreateAcUnitDto.status` + `registerExisting`
/// `generateBarcode: false`, opsional & additive, TIDAK mengubah perilaku
/// `ServiceOrdersService.intake` yang dipakai web — lihat komentarnya):
/// status dropdown admin kekirim beneran, dan barcode SENGAJA tidak
/// digenerate di sini (form `unit_form_screen.dart._submit` tetap manggil
/// RPC `generate_ac_unit_barcode` sendiri sesudahnya, sama seperti alur lama).
class NestAcUnitRepository implements AcUnitRepository {
  NestAcUnitRepository(ApiClient api, SupabaseClient client)
      : _get = api.get,
        _post = api.post,
        _patch = api.patch,
        _fallback = SupabaseAcUnitRepository(client);

  /// Konstruktor uji: suntik langsung fungsi HTTP + fallback tanpa perlu
  /// mem-fork [ApiClient] atau membuat interface baru — pola sama dengan
  /// [mapErrorResponse] yang diuji lepas dari [ApiClient] di
  /// `api_client_test.dart`. [fallback] bisa diisi `FakeAcUnitRepository`.
  @visibleForTesting
  NestAcUnitRepository.forTest(this._get, this._post, this._patch, AcUnitRepository fallback)
      : _fallback = fallback;

  final Future<dynamic> Function(String path) _get;
  final Future<dynamic> Function(String path, {Object? body}) _post;
  final Future<dynamic> Function(String path, {Object? body}) _patch;
  final AcUnitRepository _fallback;

  static const _path = '/ac-units';

  @override
  Stream<List<AcUnit>> watchByMember(String memberId) =>
      _fallback.watchByMember(memberId);

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
