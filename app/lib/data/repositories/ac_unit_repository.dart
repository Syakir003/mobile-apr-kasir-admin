import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/ac_unit.dart';

/// Kontrak akses unit AC (tabel `member_ac_units`).
/// Tidak ada delete: unit dinonaktifkan lewat status `nonaktif`.
abstract interface class AcUnitRepository {
  Stream<List<AcUnit>> watchByMember(String memberId);
  Future<AcUnit?> findByBarcode(String value);
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
