import 'dart:async';

import 'package:epos_ac/data/repositories/crud_repository.dart';

/// Implementasi in-memory dari [CrudRepository] untuk pengujian.
///
/// Menyimpan item beserta id yang di-generate. Mengekspos [created], [updated],
/// dan [items] untuk asersi. Emit lewat broadcast [StreamController] dengan seed
/// awal saat [watchAll] dipanggil.
class FakeCrudRepository<T> implements CrudRepository<T> {
  FakeCrudRepository({List<MapEntry<String, T>>? seed}) {
    if (seed != null) {
      for (final e in seed) {
        _store[e.key] = e.value;
      }
    }
  }

  final Map<String, T> _store = {};
  final _controller = StreamController<List<T>>.broadcast();
  int _autoId = 0;

  /// Daftar item yang lolos ke [create], berurutan.
  final List<T> created = [];

  /// Pasangan (id, item) untuk setiap panggilan [update].
  final List<MapEntry<String, T>> updated = [];

  /// Snapshot item saat ini (nilai store).
  List<T> get items => _store.values.toList(growable: false);

  Map<String, T> get store => Map.unmodifiable(_store);

  @override
  Stream<List<T>> watchAll() {
    // Kirim seed awal secara async agar listener sempat terpasang.
    scheduleMicrotask(() {
      if (!_controller.isClosed) _controller.add(items);
    });
    return _controller.stream;
  }

  @override
  Future<String> create(T item) async {
    final id = 'fake-${_autoId++}';
    _store[id] = item;
    created.add(item);
    if (!_controller.isClosed) _controller.add(items);
    return id;
  }

  @override
  Future<void> update(String id, T item) async {
    _store[id] = item;
    updated.add(MapEntry(id, item));
    if (!_controller.isClosed) _controller.add(items);
  }

  void dispose() => _controller.close();
}
