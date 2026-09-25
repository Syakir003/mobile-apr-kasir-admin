import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/router/app_router.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../data/models/app_notification.dart';

/// Stream realtime notifikasi milik pengguna aktif (terbaru dulu). Kosong bila
/// belum ada sesi. Realtime menghormati RLS (`user_id = auth.uid()`), jadi klien
/// hanya menerima baris miliknya.
final notificationsStreamProvider =
    StreamProvider.autoDispose<List<AppNotification>>((ref) {
  final uid = ref.watch(currentUserProvider).value?.uid;
  if (uid == null) return Stream.value(const []);
  final client = ref.watch(supabaseProvider);
  return client
      .from('notifications')
      .stream(primaryKey: ['id'])
      .eq('user_id', uid)
      .order('created_at')
      .map((rows) {
        final list = [
          for (final r in rows)
            AppNotification.fromMap(r['id'] as String, Map.from(r)),
        ];
        // Realtime `.order` naik; tampilkan terbaru dulu.
        list.sort((a, b) => (b.createdAt ?? DateTime(0))
            .compareTo(a.createdAt ?? DateTime(0)));
        return list;
      });
});

/// Jumlah notifikasi belum terbaca (untuk badge lonceng).
final unreadCountProvider = Provider.autoDispose<int>((ref) {
  final list = ref.watch(notificationsStreamProvider).value ?? const [];
  return list.where((n) => !n.read).length;
});

/// `PATCH /notifications/read` — pengganti RPC `mark_notifications_read` pada
/// migrasi Flutter -> Nest (endpoint yang sama sudah dipakai web, lihat
/// `notification-bell.tsx`). Tanpa [notificationId] menandai semua terbaca.
final markNotificationsReadCallerProvider =
    Provider<Future<void> Function({String? notificationId})>((ref) {
  return ({String? notificationId}) async {
    await const ApiClient().patch('/notifications/read', body: {
      if (notificationId != null) 'notificationId': notificationId,
    });
  };
});
