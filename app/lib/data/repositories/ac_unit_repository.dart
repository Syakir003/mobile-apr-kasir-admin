import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/ac_unit.dart';

/// Kontrak akses unit AC (koleksi `member_ac_units`).
/// Tidak ada delete: unit dinonaktifkan lewat status `nonaktif`.
abstract interface class AcUnitRepository {
  Stream<List<AcUnit>> watchByMember(String memberId);
  Future<AcUnit?> findByBarcode(String value);
  Future<String> create(AcUnit u);
  Future<void> update(String id, AcUnit u);
}

/// Implementasi [AcUnitRepository] di atas Firestore.
class FirestoreAcUnitRepository implements AcUnitRepository {
  FirestoreAcUnitRepository(this._db);

  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> get _col =>
      _db.collection('member_ac_units');

  @override
  Stream<List<AcUnit>> watchByMember(String memberId) {
    return _col.where('member_id', isEqualTo: memberId).snapshots().map(
          (snap) => snap.docs
              .map((doc) => AcUnit.fromMap(doc.id, doc.data()))
              .toList(growable: false),
        );
  }

  @override
  Future<AcUnit?> findByBarcode(String value) async {
    final snap =
        await _col.where('barcode_value', isEqualTo: value).limit(1).get();
    if (snap.docs.isEmpty) return null;
    final doc = snap.docs.first;
    return AcUnit.fromMap(doc.id, doc.data());
  }

  @override
  Future<String> create(AcUnit u) async {
    final ref = await _col.add(u.toMap());
    return ref.id;
  }

  @override
  Future<void> update(String id, AcUnit u) => _col.doc(id).set(u.toMap());
}
