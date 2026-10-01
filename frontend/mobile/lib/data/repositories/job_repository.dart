import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api/api_client.dart';
import '../models/job_history_extra.dart';
import '../models/job_photo.dart';
import '../models/material_request.dart';
import '../models/service_order.dart';
import '../models/technician_job.dart';

/// Akses baca job teknisi & order service (tabel `technician_jobs`,
/// `service_orders`, `service_order_units`). Dibaca via `.select()` (bukan
/// realtime `.stream()`) supaya tak bergantung pada keanggotaan publication
/// realtime — baris diperkaya (join client-side) dengan member/unit/teknisi,
/// pola sama seperti [SupabaseInvoiceRepository] menyusun `items`. Semua tulis
/// lewat RPC (`assign_technician_job`, `update_technician_job_status`);
/// pemanggil memanggil ulang (invalidate) untuk menyegarkan.
abstract interface class JobRepository {
  /// Job teknisi; bila [technicianId] diisi hanya job milik teknisi tsb.
  Future<List<TechnicianJob>> fetchJobs({String? technicianId});
  Future<TechnicianJob?> fetchJobById(String id);

  /// Riwayat job untuk satu unit AC (terbaru dulu) — pemasangan, cuci,
  /// service, maintenance. Dipakai layar "Riwayat Service" per unit.
  Future<List<TechnicianJob>> fetchJobsByUnit(String unitId);

  Future<List<ServiceOrder>> fetchOrders();

  /// Foto bukti untuk satu job (urut terlama → terbaru).
  Future<List<JobPhoto>> fetchPhotos(String jobId);

  /// Unggah biner foto ke bucket `job-photos`; kembalikan object path yang
  /// dicatat lewat RPC `add_job_photo`. Path unik per timestamp.
  Future<String> uploadPhoto({
    required String jobId,
    required PhotoKind kind,
    required Uint8List bytes,
    required String ext,
    required String contentType,
  });

  /// Signed URL sementara (privat) untuk menampilkan foto pada [path].
  Future<String> signedPhotoUrl(String path, {int expiresInSeconds = 3600});

  /// Pengajuan tambahan untuk satu job (terbaru dulu), lengkap dengan itemnya.
  Future<List<MaterialRequest>> fetchRequests(String jobId);

  /// Ringkasan foto & material untuk BANYAK job sekaligus (dua query, bukan
  /// dua query per job). Dipakai layar riwayat service yang menampilkan
  /// puluhan entri sekaligus. Job tanpa data balik memetakan ke
  /// [JobHistoryExtra.empty].
  Future<Map<String, JobHistoryExtra>> fetchHistoryExtras(List<String> jobIds);
}

/// Nama bucket Storage privat untuk foto bukti pengerjaan.
const String kJobPhotosBucket = 'job-photos';

class SupabaseJobRepository implements JobRepository {
  SupabaseJobRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<TechnicianJob>> fetchJobs({String? technicianId}) async {
    var query = _client.from('technician_jobs').select();
    if (technicianId != null) {
      query = query.eq('technician_id', technicianId);
    }
    final rows = await query.order('created_at', ascending: false).limit(200);
    return _enrichJobs(_asMaps(rows));
  }

  @override
  Future<TechnicianJob?> fetchJobById(String id) async {
    final rows = await _client.from('technician_jobs').select().eq('id', id);
    final list = await _enrichJobs(_asMaps(rows));
    return list.isEmpty ? null : list.first;
  }

  @override
  Future<List<TechnicianJob>> fetchJobsByUnit(String unitId) async {
    final rows = await _client
        .from('technician_jobs')
        .select()
        .eq('unit_id', unitId)
        .order('created_at', ascending: false)
        .limit(100);
    return _enrichJobs(_asMaps(rows));
  }

  @override
  Future<List<ServiceOrder>> fetchOrders() async {
    final rows = await _client
        .from('service_orders')
        .select()
        .order('created_at', ascending: false)
        .limit(100);
    return _enrichOrders(_asMaps(rows));
  }

  @override
  Future<List<JobPhoto>> fetchPhotos(String jobId) async {
    final rows = await _client
        .from('job_photos')
        .select()
        .eq('job_id', jobId)
        .order('created_at', ascending: true);
    return [
      for (final r in _asMaps(rows)) JobPhoto.fromMap(r['id'] as String, r),
    ];
  }

  @override
  Future<String> uploadPhoto({
    required String jobId,
    required PhotoKind kind,
    required Uint8List bytes,
    required String ext,
    required String contentType,
  }) async {
    final path = buildJobPhotoPath(
      jobId,
      kind,
      DateTime.now().millisecondsSinceEpoch,
      ext,
    );
    await _client.storage.from(kJobPhotosBucket).uploadBinary(
          path,
          bytes,
          fileOptions: FileOptions(contentType: contentType, upsert: false),
        );
    return path;
  }

  @override
  Future<String> signedPhotoUrl(String path, {int expiresInSeconds = 3600}) {
    return _client.storage
        .from(kJobPhotosBucket)
        .createSignedUrl(path, expiresInSeconds);
  }

  @override
  Future<List<MaterialRequest>> fetchRequests(String jobId) async {
    final rows = await _client
        .from('material_requests')
        .select()
        .eq('job_id', jobId)
        .order('created_at', ascending: false);
    final reqs = _asMaps(rows);
    if (reqs.isEmpty) return const [];

    // Ambil semua item sekali jalan, lalu kelompokkan per request_id.
    final ids = [for (final r in reqs) r['id'] as String];
    final itemRows = await _client
        .from('material_request_items')
        .select()
        .inFilter('request_id', ids);
    final byReq = <String, List<Map<String, dynamic>>>{};
    for (final it in _asMaps(itemRows)) {
      (byReq[it['request_id'] as String] ??= []).add(it);
    }

    return [
      for (final r in reqs)
        MaterialRequest.fromMap(r['id'] as String, {
          ...r,
          'items': byReq[r['id']] ?? const [],
        }),
    ];
  }

  @override
  Future<Map<String, JobHistoryExtra>> fetchHistoryExtras(
      List<String> jobIds) async {
    if (jobIds.isEmpty) return const {};

    final photoRows = await _client
        .from('job_photos')
        .select('job_id,kind')
        .inFilter('job_id', jobIds);
    final reqRows = await _client
        .from('material_requests')
        .select('job_id,status,total')
        .inFilter('job_id', jobIds);

    final before = <String, int>{};
    final after = <String, int>{};
    for (final r in _asMaps(photoRows)) {
      final jid = (r['job_id'] as String?) ?? '';
      if (r['kind'] == PhotoKind.sesudah.value) {
        after[jid] = (after[jid] ?? 0) + 1;
      } else {
        before[jid] = (before[jid] ?? 0) + 1;
      }
    }

    final items = <String, int>{};
    final totals = <String, int>{};
    final pending = <String, int>{};
    for (final r in _asMaps(reqRows)) {
      final jid = (r['job_id'] as String?) ?? '';
      final status = RequestStatus.fromValue(r['status']);
      if (status == RequestStatus.approved) {
        items[jid] = (items[jid] ?? 0) + 1;
        totals[jid] = (totals[jid] ?? 0) + ((r['total'] as num?)?.toInt() ?? 0);
      } else if (status == RequestStatus.pending) {
        pending[jid] = (pending[jid] ?? 0) + 1;
      }
    }

    // Nilai 0 sengaja tidak dibedakan antara "memang tak ada" dan "disaring
    // RLS" — dari sisi client keduanya tak bisa dibedakan. UI menanganinya
    // dengan tidak menampilkan baris material sama sekali saat nol, alih-alih
    // menuliskan klaim "tanpa material" yang belum tentu benar.
    return {
      for (final id in jobIds)
        id: JobHistoryExtra(
          photosBefore: before[id] ?? 0,
          photosAfter: after[id] ?? 0,
          materialItems: items[id] ?? 0,
          materialTotal: totals[id] ?? 0,
          materialPending: pending[id] ?? 0,
        ),
    };
  }

  List<Map<String, dynamic>> _asMaps(dynamic rows) => [
        for (final r in (rows as List)) Map<String, dynamic>.from(r as Map),
      ];

  Future<List<TechnicianJob>> _enrichJobs(
      List<Map<String, dynamic>> rows) async {
    if (rows.isEmpty) return const [];
    final memberIds = <String>{};
    final unitIds = <String>{};
    final techIds = <String>{};
    for (final r in rows) {
      final m = r['member_id'] as String?;
      final u = r['unit_id'] as String?;
      final t = r['technician_id'] as String?;
      if (m != null) memberIds.add(m);
      if (u != null) unitIds.add(u);
      if (t != null) techIds.add(t);
    }
    final members = await _fetchByIds('members', 'id,name,phone,address', memberIds);
    final units = await _fetchByIds('member_ac_units',
        'id,brand,model,pk,room_location,barcode_value,status', unitIds);
    final techs = await _fetchByIds('users', 'id,display_name', techIds);

    return rows.map((r) {
      final data = Map<String, dynamic>.from(r);
      data['member'] = members[r['member_id']];
      data['unit'] = units[r['unit_id']];
      data['technician_name'] = techs[r['technician_id']]?['display_name'];
      return TechnicianJob.fromMap(r['id'] as String, data);
    }).toList(growable: false);
  }

  Future<List<ServiceOrder>> _enrichOrders(
      List<Map<String, dynamic>> rows) async {
    if (rows.isEmpty) return const [];
    final memberIds = <String>{};
    final orderIds = <String>[];
    for (final r in rows) {
      final m = r['member_id'] as String?;
      if (m != null) memberIds.add(m);
      orderIds.add(r['id'] as String);
    }
    final members = await _fetchByIds('members', 'id,name', memberIds);

    // Hitung jumlah unit & unit selesai per order dalam satu query.
    final unitRows = await _client
        .from('service_order_units')
        .select('order_id,status')
        .inFilter('order_id', orderIds);
    final total = <String, int>{};
    final done = <String, int>{};
    for (final u in (unitRows as List)) {
      final oid = u['order_id'] as String;
      total[oid] = (total[oid] ?? 0) + 1;
      if (u['status'] == 'selesai') done[oid] = (done[oid] ?? 0) + 1;
    }

    return rows.map((r) {
      final id = r['id'] as String;
      final data = Map<String, dynamic>.from(r);
      data['member'] = members[r['member_id']];
      data['unit_count'] = total[id] ?? 0;
      data['done_count'] = done[id] ?? 0;
      return ServiceOrder.fromMap(id, data);
    }).toList(growable: false);
  }

  Future<Map<String, Map<String, dynamic>>> _fetchByIds(
      String table, String columns, Set<String> ids) async {
    if (ids.isEmpty) return const {};
    final rows =
        await _client.from(table).select(columns).inFilter('id', ids.toList());
    return {
      for (final row in (rows as List))
        (row['id'] as String): Map<String, dynamic>.from(row as Map),
    };
  }
}

// =============================================================================
// Nest: konversi camelCase -> snake_case. Prisma mengembalikan JSON camelCase
// (id, orderId, memberId, ...) sementara `TechnicianJob.fromMap` dkk ditulis
// untuk baris PostgREST snake_case — fungsi murni di bawah ini menjembatani
// keduanya TANPA mengubah kontrak fromMap (biar SupabaseJobRepository, yang
// dipertahankan untuk rollback, tak perlu ikut disentuh). Diekspos top-level
// (bukan method privat) supaya bisa diuji langsung tanpa mock HTTP, pola sama
// seperti `acUnitRowFromNest` di ac_unit_repository.dart.
// =============================================================================

/// Field `Decimal` Prisma (mis. `pk`, `qty`) di-serialize `JSON.stringify`
/// sebagai STRING (decimal.js `toJSON()`), bukan number — parser di bawah
/// menerima keduanya.
num? numFromNest(Object? v) => switch (v) {
      num n => n,
      String s => num.tryParse(s),
      _ => null,
    };

/// Baris `technician_jobs` dari Nest (relasi `member`/`unit`/`technician`
/// bersarang) -> bentuk yang dibaca [TechnicianJob.fromMap].
Map<String, dynamic> technicianJobRowFromNest(Map<String, dynamic> j) {
  final member = j['member'] as Map?;
  final unit = j['unit'] as Map?;
  final technician = j['technician'] as Map?;
  return {
    'order_id': j['orderId'],
    'member_id': j['memberId'],
    'unit_id': j['unitId'],
    'technician_id': j['technicianId'],
    'type': j['type'],
    'status': j['status'],
    'scheduled_date': j['scheduledDate'],
    'notes': j['notes'],
    'started_at': j['startedAt'],
    'completed_at': j['completedAt'],
    'created_at': j['createdAt'],
    if (member != null)
      'member': {
        'name': member['name'],
        'phone': member['phone'],
        'address': member['address'],
      },
    if (unit != null)
      'unit': {
        'brand': unit['brand'],
        'model': unit['model'],
        'pk': numFromNest(unit['pk']),
        'room_location': unit['roomLocation'],
        'barcode_value': unit['barcodeValue'],
      },
    if (technician != null) 'technician_name': technician['displayName'],
  };
}

/// Baris `photos` (model lama, level-job) bersarang di respons
/// `GET /technician-jobs/:id` -> bentuk yang dibaca [JobPhoto.fromMap].
Map<String, dynamic> jobPhotoRowFromNest(Map<String, dynamic> p) => {
      'job_id': p['jobId'],
      'kind': p['kind'],
      'path': p['path'],
      'created_at': p['createdAt'],
    };

/// Baris `materialRequests` (+ `items`) bersarang di respons
/// `GET /technician-jobs/:id` -> bentuk yang dibaca [MaterialRequest.fromMap].
Map<String, dynamic> materialRequestRowFromNest(Map<String, dynamic> r) => {
      'job_id': r['jobId'],
      'status': r['status'],
      'total': r['total'],
      'invoice_id': r['invoiceId'],
      'note': r['note'],
      'decision_note': r['decisionNote'],
      'created_at': r['createdAt'],
      'decided_at': r['decidedAt'],
      'used_at': r['usedAt'],
      'items': [
        for (final it in (r['items'] as List? ?? const []))
          _materialRequestItemRowFromNest(Map<String, dynamic>.from(it as Map)),
      ],
    };

Map<String, dynamic> _materialRequestItemRowFromNest(Map<String, dynamic> it) => {
      'id': it['id'],
      'kind': it['kind'],
      'ref_id': it['refId'],
      'name': it['name'],
      'unit': it['unit'],
      'qty': numFromNest(it['qty']),
      'unit_price': it['unitPrice'],
      'line_total': it['lineTotal'],
    };

/// Baris `service_orders` dari Nest (`GET /service-orders`, relasi `member` +
/// `serviceOrderUnits` bersarang) -> bentuk yang dibaca [ServiceOrder.fromMap].
/// `unit_count`/`done_count` dihitung dari `serviceOrderUnits` — sama seperti
/// [SupabaseJobRepository._enrichOrders] menghitungnya dari `service_order_units`.
Map<String, dynamic> serviceOrderRowFromNest(Map<String, dynamic> o) {
  final member = o['member'] as Map?;
  final units = (o['serviceOrderUnits'] as List? ?? const [])
      .map((u) => Map<String, dynamic>.from(u as Map))
      .toList(growable: false);
  return {
    'member_id': o['memberId'],
    'invoice_id': o['invoiceId'],
    'type': o['type'],
    'status': o['status'],
    'created_at': o['createdAt'],
    if (member != null) 'member': {'name': member['name']},
    'unit_count': units.length,
    'done_count': units.where((u) => u['status'] == 'selesai').length,
  };
}

/// Satu entri `GET /technician-jobs/history-extras` (sudah camelCase persis
/// sama dengan field [JobHistoryExtra]) -> instance model.
JobHistoryExtra jobHistoryExtraFromNest(Map<String, dynamic> j) => JobHistoryExtra(
      photosBefore: (j['photosBefore'] as num?)?.toInt() ?? 0,
      photosAfter: (j['photosAfter'] as num?)?.toInt() ?? 0,
      materialItems: (j['materialItems'] as num?)?.toInt() ?? 0,
      materialTotal: (j['materialTotal'] as num?)?.toInt() ?? 0,
      materialPending: (j['materialPending'] as num?)?.toInt() ?? 0,
    );

/// Implementasi [JobRepository] lewat backend NestJS — pengganti
/// [SupabaseJobRepository] pada migrasi Flutter -> Nest (dibiarkan ada di
/// atas untuk rollback cepat).
///
/// Semua method sudah pindah ke Nest:
/// - [fetchJobsByUnit] -> `GET /technician-jobs?unitId=`, ditambahkan khusus
///   buat ini (lihat `FindAllJobsQueryDto`/`TechnicianJobsService.findAll`).
///   RBAC teknisi di-port dari RLS `my_visible_job_ids()`: WAJIB isi
///   `unitId`, dan cuma kebagian hasil kalau dia sendiri punya job di unit
///   itu (all-or-nothing per unit, sama seperti RLS lama).
/// - [fetchOrders] -> `GET /service-orders` tanpa query (cabang baru di
///   `findByCustomer`, admin/kasir only) — list 100 order terbaru.
/// - [fetchHistoryExtras] -> `GET /technician-jobs/history-extras?jobIds=`,
///   endpoint bulk baru. RBAC di-port dari RLS `job_photos`/
///   `material_requests`: teknisi cuma dihitung foto job VISIBLE (miliknya +
///   job lain di unit yang sama) dan material job MILIKNYA saja.
///
/// Semua field enrichment (member/unit/teknisi/foto/material) SUDAH datang
/// bersarang dari `GET /technician-jobs/:id` (findOne Nest sengaja dibuat
/// lebih kaya dari PostgREST) — [fetchPhotos]/[fetchRequests] jadi cukup 1
/// panggilan yang sama, tidak perlu endpoint terpisah.
class NestJobRepository implements JobRepository {
  NestJobRepository(ApiClient api)
      : _get = api.get,
        _postMultipart = api.postMultipart,
        _baseUrl = api.baseUrl;

  /// Konstruktor uji: suntik langsung fungsi HTTP tanpa perlu HTTP sungguhan
  /// — pola sama dengan `NestAcUnitRepository.forTest`.
  @visibleForTesting
  NestJobRepository.forTest(this._get, this._postMultipart, this._baseUrl);

  final Future<dynamic> Function(String path) _get;
  final Future<dynamic> Function(
    String path, {
    required String fileField,
    required List<int> bytes,
    required String filename,
    required String contentType,
    Map<String, String> fields,
  }) _postMultipart;
  final String _baseUrl;

  static const _path = '/technician-jobs';

  @override
  Future<List<TechnicianJob>> fetchJobs({String? technicianId}) async {
    if (technicianId == null) {
      // Admin/kasir: findAll (semua job, tanpa filter teknisi — konsisten
      // dengan pemanggil, yang cuma pernah minta technicianId = diri sendiri).
      final json = await _get(_path) as List;
      return [
        for (final r in json)
          TechnicianJob.fromMap(
            r['id'] as String,
            technicianJobRowFromNest(Map<String, dynamic>.from(r as Map)),
          ),
      ];
    }
    // Teknisi: TIDAK ADA satu endpoint yang balikin "semua job milik saya
    // apa pun statusnya" seperti query Supabase lama. Gabungan terdekat:
    // queue (aktif: assigned/sedang_dikerjakan) + history (selesai saja,
    // dipaginasi). CATATAN GAP: job berstatus 'dibatalkan' milik teknisi
    // tidak muncul di mana pun (queue maupun history tidak menyertakannya)
    // — lihat laporan migrasi. pageSize 200 menyamai `limit(200)` versi
    // Supabase lama.
    final queueJson = await _get('$_path/queue') as List;
    final historyJson = await _get('$_path/history?page=1&pageSize=200') as Map;
    final historyItems = (historyJson['items'] as List?) ?? const [];
    return [
      for (final r in queueJson)
        TechnicianJob.fromMap(
          r['id'] as String,
          technicianJobRowFromNest(Map<String, dynamic>.from(r as Map)),
        ),
      for (final r in historyItems)
        TechnicianJob.fromMap(
          r['id'] as String,
          technicianJobRowFromNest(Map<String, dynamic>.from(r as Map)),
        ),
    ];
  }

  @override
  Future<TechnicianJob?> fetchJobById(String id) async {
    final json = await _jobDetailOrNull(id);
    if (json == null) return null;
    return TechnicianJob.fromMap(id, technicianJobRowFromNest(json));
  }

  @override
  Future<List<TechnicianJob>> fetchJobsByUnit(String unitId) async {
    final json = await _get('$_path?unitId=${Uri.encodeComponent(unitId)}') as List;
    return [
      for (final r in json)
        TechnicianJob.fromMap(
          r['id'] as String,
          technicianJobRowFromNest(Map<String, dynamic>.from(r as Map)),
        ),
    ];
  }

  @override
  Future<List<ServiceOrder>> fetchOrders() async {
    final json = await _get('/service-orders') as List;
    return [
      for (final r in json)
        ServiceOrder.fromMap(
          (r as Map)['id'] as String,
          serviceOrderRowFromNest(Map<String, dynamic>.from(r)),
        ),
    ];
  }

  @override
  Future<List<JobPhoto>> fetchPhotos(String jobId) async {
    final json = await _jobDetailOrNull(jobId);
    if (json == null) return const [];
    final photos = (json['photos'] as List?) ?? const [];
    return [
      for (final p in photos)
        JobPhoto.fromMap(
          (p as Map)['id'] as String,
          jobPhotoRowFromNest(Map<String, dynamic>.from(p)),
        ),
    ];
  }

  @override
  Future<String> uploadPhoto({
    required String jobId,
    required PhotoKind kind,
    required Uint8List bytes,
    required String ext,
    required String contentType,
  }) async {
    // Satu panggilan multipart melakukan KEDUANYA (simpan file + catat baris
    // job_photos) — beda dari alur Supabase lama (upload Storage lalu RPC
    // `add_job_photo` terpisah). Lihat POST /technician-jobs/:id/photos.
    final json = await _postMultipart(
      '$_path/$jobId/photos',
      fileField: 'photo',
      bytes: bytes,
      filename: 'photo.$ext',
      contentType: contentType,
      fields: {'kind': kind.value},
    ) as Map;
    return json['path'] as String;
  }

  @override
  Future<String> signedPhotoUrl(String path, {int expiresInSeconds = 3600}) async {
    // Foto Nest disajikan statis PUBLIK (app.useStaticAssets di main.ts) —
    // nama file UUID server-generated tak bisa ditebak, jadi tak perlu
    // signing seperti Supabase Storage. expiresInSeconds diabaikan, tetap
    // dipertahankan di interface biar SupabaseJobRepository (rollback) tak
    // perlu diubah.
    // ponytail: foto job LAMA (pra-migrasi, path gaya Supabase Storage tanpa
    // awalan '/uploads') tidak akan bisa dimuat lewat baseUrl Nest — belum
    // relevan sekarang (cloud Supabase baru aktif sesi ini, belum ada data
    // foto produksi), tambahkan deteksi path lama dulu kalau kejadian nyata.
    return '$_baseUrl$path';
  }

  @override
  Future<List<MaterialRequest>> fetchRequests(String jobId) async {
    final json = await _jobDetailOrNull(jobId);
    if (json == null) return const [];
    final reqs = (json['materialRequests'] as List?) ?? const [];
    return [
      for (final r in reqs)
        MaterialRequest.fromMap(
          (r as Map)['id'] as String,
          materialRequestRowFromNest(Map<String, dynamic>.from(r)),
        ),
    ];
  }

  @override
  Future<Map<String, JobHistoryExtra>> fetchHistoryExtras(List<String> jobIds) async {
    if (jobIds.isEmpty) return const {};
    final json = await _get('$_path/history-extras?jobIds=${jobIds.join(',')}') as Map;
    return {
      for (final entry in json.entries)
        entry.key as String: jobHistoryExtraFromNest(
          Map<String, dynamic>.from(entry.value as Map),
        ),
    };
  }

  Future<Map<String, dynamic>?> _jobDetailOrNull(String jobId) async {
    try {
      final json = await _get('$_path/$jobId') as Map;
      return Map<String, dynamic>.from(json);
    } on NestApiException catch (e) {
      if (e.statusCode == 404) return null;
      rethrow;
    }
  }
}
