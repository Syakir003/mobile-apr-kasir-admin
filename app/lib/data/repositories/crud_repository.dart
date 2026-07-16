import 'package:supabase_flutter/supabase_flutter.dart';

/// Kontrak CRUD generik untuk tabel master data.
/// Tidak menyediakan delete (nonaktif via field `active`).
abstract interface class CrudRepository<T> {
  Stream<List<T>> watchAll();
  Future<String> create(T item);
  Future<void> update(String id, T item);
}

/// Implementasi [CrudRepository] di atas Supabase (PostgREST + Realtime).
///
/// - [watchAll] men-stream seluruh baris terurut kolom `name`.
/// - [create] menyisipkan baris baru (id di-generate Postgres).
/// - [update] menimpa baris dengan id tertentu.
class SupabaseCrudRepository<T> implements CrudRepository<T> {
  SupabaseCrudRepository(
    this._client,
    this._table,
    this._fromMap,
    this._toMap,
  );

  final SupabaseClient _client;
  final String _table;
  final T Function(String id, Map<String, dynamic> data) _fromMap;
  final Map<String, dynamic> Function(T item) _toMap;

  @override
  Stream<List<T>> watchAll() {
    return _client
        .from(_table)
        .stream(primaryKey: ['id'])
        .order('name', ascending: true)
        .map(
          (rows) => rows
              .map((row) => _fromMap(row['id'] as String, row))
              .toList(growable: false),
        );
  }

  @override
  Future<String> create(T item) async {
    final row =
        await _client.from(_table).insert(_toMap(item)).select('id').single();
    return row['id'] as String;
  }

  @override
  Future<void> update(String id, T item) =>
      _client.from(_table).update(_toMap(item)).eq('id', id);
}
