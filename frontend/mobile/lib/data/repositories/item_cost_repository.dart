import 'package:supabase_flutter/supabase_flutter.dart';

/// Jenis barang yang punya harga modal. Nilai `value` harus sama persis dengan
/// enum `item_kind` di Postgres.
enum CostKind {
  product('product'),
  sparepart('sparepart');

  const CostKind(this.value);
  final String value;
}

/// Akses harga modal (`item_costs`).
///
/// Harga modal dipisah dari `products`/`spareparts` sejak migrasi 0021 supaya
/// hanya admin yang bisa membacanya — kasir & teknisi tetap butuh `sell_price`,
/// tapi tidak boleh bisa menghitung margin. RLS tabel ini admin-only, jadi
/// pemanggilan dari peran lain wajar mengembalikan 0 / gagal senyap.
abstract interface class ItemCostRepository {
  /// Harga modal satu barang; 0 bila belum pernah diisi atau tak boleh dibaca.
  Future<int> fetch(CostKind kind, String refId);

  /// Simpan (upsert) harga modal satu barang.
  Future<void> save(CostKind kind, String refId, int buyPrice);

  /// Seluruh harga modal per jenis, dikunci `refId`. Dipakai laporan untuk
  /// menghitung nilai persediaan tanpa N+1 query.
  Future<Map<String, int>> fetchAll(CostKind kind);
}

class SupabaseItemCostRepository implements ItemCostRepository {
  SupabaseItemCostRepository(this._client);

  final SupabaseClient _client;
  static const _table = 'item_costs';

  @override
  Future<int> fetch(CostKind kind, String refId) async {
    if (refId.isEmpty) return 0;
    final row = await _client
        .from(_table)
        .select('buy_price')
        .eq('kind', kind.value)
        .eq('ref_id', refId)
        .maybeSingle();
    return (row?['buy_price'] as num?)?.toInt() ?? 0;
  }

  @override
  Future<void> save(CostKind kind, String refId, int buyPrice) async {
    if (refId.isEmpty) return;
    await _client.from(_table).upsert({
      'kind': kind.value,
      'ref_id': refId,
      'buy_price': buyPrice,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }, onConflict: 'kind,ref_id');
  }

  @override
  Future<Map<String, int>> fetchAll(CostKind kind) async {
    final rows = await _client
        .from(_table)
        .select('ref_id,buy_price')
        .eq('kind', kind.value);
    return {
      for (final r in (rows as List))
        '${(r as Map)['ref_id']}': ((r['buy_price'] as num?) ?? 0).toInt(),
    };
  }
}
