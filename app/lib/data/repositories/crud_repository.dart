import 'package:cloud_firestore/cloud_firestore.dart';

/// Kontrak CRUD generik untuk koleksi master data.
/// Tidak menyediakan delete (nonaktif via field `active`).
abstract interface class CrudRepository<T> {
  Stream<List<T>> watchAll();
  Future<String> create(T item);
  Future<void> update(String id, T item);
}

/// Implementasi [CrudRepository] di atas Firestore.
///
/// - [watchAll] mengembalikan snapshot terurut berdasarkan field `name`.
/// - [create] menambah dokumen baru (id di-generate Firestore).
/// - [update] menimpa dokumen dengan id tertentu.
class FirestoreCrudRepository<T> implements CrudRepository<T> {
  FirestoreCrudRepository(
    this._db,
    this._collection,
    this._fromMap,
    this._toMap,
  );

  final FirebaseFirestore _db;
  final String _collection;
  final T Function(String id, Map<String, dynamic> data) _fromMap;
  final Map<String, dynamic> Function(T item) _toMap;

  CollectionReference<Map<String, dynamic>> get _col => _db.collection(_collection);

  @override
  Stream<List<T>> watchAll() {
    return _col.orderBy('name').snapshots().map(
          (snap) => snap.docs
              .map((doc) => _fromMap(doc.id, doc.data()))
              .toList(growable: false),
        );
  }

  @override
  Future<String> create(T item) async {
    final ref = await _col.add(_toMap(item));
    return ref.id;
  }

  @override
  Future<void> update(String id, T item) => _col.doc(id).set(_toMap(item));
}
