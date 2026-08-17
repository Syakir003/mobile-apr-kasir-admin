import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../data/models/undian.dart';

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

/// RPC `create_undian` (admin).
final createUndianCallerProvider = Provider<
    Future<({String undianId, int participantCount})> Function(
        Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final result = await ref
        .read(supabaseProvider)
        .rpc('create_undian', params: {'payload': payload});
    final data = result as Map;
    return (
      undianId: (data['undianId'] as String?) ?? '',
      participantCount: (data['participantCount'] as num?)?.toInt() ?? 0,
    );
  };
});

/// RPC `update_undian_participants` (admin).
final updateUndianParticipantsCallerProvider = Provider<
    Future<void> Function(String undianId,
        {List<String> add, List<String> remove})>((ref) {
  return (undianId, {add = const [], remove = const []}) async {
    await ref.read(supabaseProvider).rpc('update_undian_participants', params: {
      'payload': {
        'undianId': undianId,
        if (add.isNotEmpty) 'add': add,
        if (remove.isNotEmpty) 'remove': remove,
      },
    });
  };
});

/// RPC `draw_undian` (admin). Mengembalikan jumlah pemenang.
final drawUndianCallerProvider =
    Provider<Future<int> Function(String undianId)>((ref) {
  return (undianId) async {
    final result = await ref.read(supabaseProvider).rpc('draw_undian', params: {
      'payload': {'undianId': undianId},
    });
    return ((result as Map)['winnerCount'] as num?)?.toInt() ?? 0;
  };
});

/// RPC `cancel_undian` (admin).
final cancelUndianCallerProvider =
    Provider<Future<void> Function(String undianId)>((ref) {
  return (undianId) async {
    await ref.read(supabaseProvider).rpc('cancel_undian', params: {
      'payload': {'undianId': undianId},
    });
  };
});
