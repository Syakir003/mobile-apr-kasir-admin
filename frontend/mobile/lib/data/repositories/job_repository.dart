import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart';

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
