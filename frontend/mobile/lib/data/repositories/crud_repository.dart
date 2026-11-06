/// Kontrak CRUD generik untuk tabel master data.
/// Tidak menyediakan delete (nonaktif via field `active`).
abstract interface class CrudRepository<T> {
  Stream<List<T>> watchAll();
  Future<String> create(T item);
  Future<void> update(String id, T item);
}
