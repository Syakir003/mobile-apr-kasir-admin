import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../models/job_history_extra.dart';
import '../models/job_photo.dart';
import '../models/material_request.dart';
import '../models/service_order.dart';
import '../models/technician_job.dart';
import '../../core/utils/num_parse.dart';

/// Akses baca job teknisi & order service lewat backend Nest (GET).
/// Semua tulis lewat endpoint Nest di job_providers.dart; pemanggil
/// invalidate provider untuk menyegarkan.
/// Riwayat satu unit AC: daftar job + ringkasan per job (kunci = id job).
typedef UnitHistory = ({
  List<TechnicianJob> jobs,
  Map<String, JobHistoryExtra> extras,
});

abstract interface class JobRepository {
  /// Job teknisi; bila [technicianId] diisi hanya job milik teknisi tsb.
  Future<List<TechnicianJob>> fetchJobs({String? technicianId});
  Future<TechnicianJob?> fetchJobById(String id);

  /// SEMUA job di satu unit AC (terbaru dulu) + ringkasan foto & material
  /// per job. Dipakai layar "Riwayat Service" per unit (semua role).
  Future<UnitHistory> fetchUnitHistory(String unitId);

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
      photosBefore: numFromNest(j['photosBefore'])?.toInt() ?? 0,
      photosAfter: numFromNest(j['photosAfter'])?.toInt() ?? 0,
      materialItems: numFromNest(j['materialItems'])?.toInt() ?? 0,
      materialTotal: numFromNest(j['materialTotal'])?.toInt() ?? 0,
      materialPending: numFromNest(j['materialPending'])?.toInt() ?? 0,
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
    // Teknisi: GET /technician-jobs/mine = semua job miliknya, status apa
    // pun (queue + history native gak memuat menunggu_review/dibatalkan).
    final json = await _get('$_path/mine') as List;
    return [
      for (final r in json)
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

  /// GET /ac-units/:id/jobs — native mengabaikan ?unitId= di
  /// /technician-jobs, dan history-extras sudah tidak ada.
  @override
  Future<UnitHistory> fetchUnitHistory(String unitId) async {
    final json = await _get('/ac-units/${Uri.encodeComponent(unitId)}/jobs') as Map;
    final extras = (json['extras'] as Map?) ?? const {};
    return (
      jobs: [
        for (final r in (json['jobs'] as List? ?? const []))
          TechnicianJob.fromMap(
            (r as Map)['id'] as String,
            technicianJobRowFromNest(Map<String, dynamic>.from(r)),
          ),
      ],
      extras: {
        for (final e in extras.entries)
          e.key as String: jobHistoryExtraFromNest(Map<String, dynamic>.from(e.value as Map)),
      },
    );
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
