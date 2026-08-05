import 'dart:async';

import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/repositories/ac_unit_repository.dart';

/// Implementasi in-memory dari [AcUnitRepository] untuk pengujian.
///
/// Pola sama dengan `FakeCrudRepository`: emit lewat broadcast
/// [StreamController] dengan seed awal via [scheduleMicrotask]. Item
/// tersimpan dengan `id` terisi (meniru `doc.id` Firestore).
class FakeAcUnitRepository implements AcUnitRepository {
  FakeAcUnitRepository({List<MapEntry<String, AcUnit>>? seed}) {
    if (seed != null) {
      for (final e in seed) {
        _store[e.key] = e.value.copyWith(id: e.key);
      }
    }
  }

  final Map<String, AcUnit> _store = {};
  final _controller = StreamController<List<AcUnit>>.broadcast();
  int _autoId = 0;

  /// Daftar unit yang lolos ke [create], berurutan.
  final List<AcUnit> created = [];

  /// Pasangan (id, unit) untuk setiap panggilan [update].
  final List<MapEntry<String, AcUnit>> updated = [];

  /// Snapshot unit saat ini (nilai store, id terisi).
  List<AcUnit> get items => _store.values.toList(growable: false);

  @override
  Stream<List<AcUnit>> watchByMember(String memberId) {
    scheduleMicrotask(() {
      if (!_controller.isClosed) _controller.add(items);
    });
    return _controller.stream.map(
      (all) =>
          all.where((u) => u.memberId == memberId).toList(growable: false),
    );
  }

  @override
  Future<AcUnit?> findByBarcode(String value) async {
    for (final u in items) {
      if (u.barcodeValue == value) return u;
    }
    return null;
  }

  @override
  Future<AcUnit?> findById(String id) async => _store[id];

  @override
  Future<String> create(AcUnit u) async {
    final id = 'fake-unit-${_autoId++}';
    _store[id] = u.copyWith(id: id);
    created.add(u);
    if (!_controller.isClosed) _controller.add(items);
    return id;
  }

  @override
  Future<void> update(String id, AcUnit u) async {
    _store[id] = u.copyWith(id: id);
    updated.add(MapEntry(id, u));
    if (!_controller.isClosed) _controller.add(items);
  }

  void dispose() => _controller.close();
}
