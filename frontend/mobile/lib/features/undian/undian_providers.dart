import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../data/models/undian.dart';
import '../../core/utils/num_parse.dart';

/// Semua undian, terbaru dulu. RLS admin saja.
final undianListProvider = StreamProvider.autoDispose<List<Undian>>((ref) {
  final client = ref.watch(supabaseProvider);
  return client
      .from('undian')
      .stream(primaryKey: ['id'])
      .order('created_at')
      .map((rows) {
        final list = [
          for (final r in rows) Undian.fromMap(r['id'] as String, Map.from(r)),
        ];
        list.sort((a, b) =>
            (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
        return list;
      });
});

/// Peserta satu undian tertentu.
final undianParticipantsProvider = StreamProvider.autoDispose
    .family<List<UndianParticipant>, String>((ref, undianId) {
  final client = ref.watch(supabaseProvider);
  return client
      .from('undian_participants')
      .stream(primaryKey: ['id'])
      .eq('undian_id', undianId)
      .map((rows) => [
            for (final r in rows)
              UndianParticipant.fromMap(r['id'] as String, Map.from(r)),
          ]);
});

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
  };
});

/// `POST /undian/:id/draw` (admin) — pengganti RPC `draw_undian`. Mengembalikan
/// jumlah pemenang.
final drawUndianCallerProvider =
    Provider<Future<int> Function(String undianId)>((ref) {
  return (undianId) async {
    final data = await const ApiClient().post('/undian/$undianId/draw') as Map;
    return numFromNest(data['winnerCount'])?.toInt() ?? 0;
  };
});

/// `POST /undian/:id/cancel` (admin) — pengganti RPC `cancel_undian`.
final cancelUndianCallerProvider =
    Provider<Future<void> Function(String undianId)>((ref) {
  return (undianId) async {
    await const ApiClient().post('/undian/$undianId/cancel');
  };
});
