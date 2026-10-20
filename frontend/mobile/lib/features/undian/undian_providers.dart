import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/utils/snake_keys.dart';
import '../../data/models/undian.dart';
import '../../core/utils/num_parse.dart';

/// Semua undian, terbaru dulu (`GET /undian`, admin). Dimuat sekali per
/// pembukaan layar; mutasi di bawah me-refetch lewat invalidate.
final undianListProvider = StreamProvider.autoDispose<List<Undian>>((ref) async* {
  final rows = await const ApiClient().get('/undian') as List;
  yield [
    for (final r in rows) Undian.fromMap((r as Map)['id'] as String, snakeKeys(r)),
  ];
});

/// Peserta satu undian tertentu (`GET /undian/:id`).
final undianParticipantsProvider = StreamProvider.autoDispose
    .family<List<UndianParticipant>, String>((ref, undianId) async* {
  final data = await const ApiClient().get('/undian/$undianId') as Map;
  yield [
    for (final p in data['participants'] as List)
      UndianParticipant.fromMap((p as Map)['id'] as String, snakeKeys(p)),
  ];
});

/// Muat ulang daftar & peserta setelah mutasi undian.
void _refreshUndian(Ref ref, [String? undianId]) {
  ref.invalidate(undianListProvider);
  if (undianId != null) ref.invalidate(undianParticipantsProvider(undianId));
}

/// `POST /undian` (admin) — pengganti RPC `create_undian` pada migrasi
/// Flutter -> Nest. Payload sudah camelCase persis sama dengan
/// `CreateUndianDto` (dibangun di `undian_form_screen.dart`), diteruskan apa
/// adanya. `UndianService.create` di Nest memanggil RPC Postgres yang SAMA
/// lewat `SupabaseRpcService` (masa transisi, lihat komentarnya) — bentuk
/// respons identik dengan RPC langsung, parsing di bawah tidak berubah.
final createUndianCallerProvider = Provider<
    Future<({String undianId, int participantCount})> Function(
        Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final data = await const ApiClient().post('/undian', body: payload) as Map;
    _refreshUndian(ref);
    return (
      undianId: (data['undianId'] as String?) ?? '',
      participantCount: numFromNest(data['participantCount'])?.toInt() ?? 0,
    );
  };
});

/// `PUT /undian/:id/participants` (admin) — pengganti RPC
/// `update_undian_participants`. `undianId` sekarang di path (`UpdateUndianParticipantsDto`
/// cuma `add`/`remove`), bukan di body payload.
final updateUndianParticipantsCallerProvider = Provider<
    Future<void> Function(String undianId,
        {List<String> add, List<String> remove})>((ref) {
  return (undianId, {add = const [], remove = const []}) async {
    await const ApiClient().put('/undian/$undianId/participants', body: {
      if (add.isNotEmpty) 'add': add,
      if (remove.isNotEmpty) 'remove': remove,
    });
    _refreshUndian(ref, undianId);
  };
});

/// `POST /undian/:id/draw` (admin) — pengganti RPC `draw_undian`. Mengembalikan
/// jumlah pemenang.
final drawUndianCallerProvider =
    Provider<Future<int> Function(String undianId)>((ref) {
  return (undianId) async {
    final data = await const ApiClient().post('/undian/$undianId/draw') as Map;
    _refreshUndian(ref, undianId);
    return numFromNest(data['winnerCount'])?.toInt() ?? 0;
  };
});

/// `POST /undian/:id/cancel` (admin) — pengganti RPC `cancel_undian`.
final cancelUndianCallerProvider =
    Provider<Future<void> Function(String undianId)>((ref) {
  return (undianId) async {
    await const ApiClient().post('/undian/$undianId/cancel');
    _refreshUndian(ref, undianId);
  };
});
