import 'package:supabase_flutter/supabase_flutter.dart';

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
  Future<List<ServiceOrder>> fetchOrders();
}

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
  Future<List<ServiceOrder>> fetchOrders() async {
    final rows = await _client
        .from('service_orders')
        .select()
        .order('created_at', ascending: false)
        .limit(100);
    return _enrichOrders(_asMaps(rows));
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
