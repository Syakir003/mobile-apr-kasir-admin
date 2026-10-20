import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/realtime/realtime_service.dart';
import '../../core/router/app_router.dart';
import '../../data/models/app_notification.dart';

/// Sisipkan [incoming] di depan (terbaru dulu); id yang sudah ada diganti,
/// bukan digandakan (event socket bisa tiba setelah refetch yang sudah memuatnya).
List<AppNotification> mergeNotification(
    List<AppNotification> current, AppNotification incoming) {
  return [incoming, ...current.where((n) => n.id != incoming.id)];
}

Future<List<AppNotification>> _fetchNotifications() async {
  final res = await const ApiClient().get('/notifications?pageSize=50');
  return [
    for (final r in (res as Map)['items'] as List)
      AppNotification.fromMap((r as Map)['id'] as String, Map<String, dynamic>.from(r)),
  ];
}

/// Daftar notifikasi milik pengguna aktif (terbaru dulu): `GET /notifications`
/// lalu di-patch realtime oleh event `notification.new` (room per-user di
/// backend, jadi hanya notifikasi miliknya). Tiap (re)connect socket
/// di-refetch supaya yang terlewat saat offline ikut masuk. Kosong bila
/// belum ada sesi.
final notificationsStreamProvider =
    StreamProvider.autoDispose<List<AppNotification>>((ref) async* {
  final uid = ref.watch(currentUserProvider).value?.uid;
  if (uid == null) {
    yield const [];
    return;
  }
  final realtime = ref.watch(realtimeServiceProvider);
  var list = await _fetchNotifications();
  yield list;
  await for (final e in realtime.events) {
    if (e.name == 'connect') {
      list = await _fetchNotifications();
    } else if (e.name == 'notification.new' && e.data is Map) {
      final data = Map<String, dynamic>.from(e.data as Map);
      list = mergeNotification(list, AppNotification.fromMap(data['id'] as String, data));
    } else {
      continue;
    }
    yield list;
  }
});

/// Jumlah notifikasi belum terbaca (untuk badge lonceng).
final unreadCountProvider = Provider.autoDispose<int>((ref) {
  final list = ref.watch(notificationsStreamProvider).value ?? const [];
  return list.where((n) => !n.read).length;
});

/// `PATCH /notifications/read` — pengganti RPC `mark_notifications_read`
/// (endpoint yang sama dipakai web, lihat `notification-bell.tsx`). Tanpa
/// [notificationId] menandai semua terbaca. Daftar dimuat ulang sesudahnya
/// karena backend tidak memancarkan event untuk perubahan status baca.
final markNotificationsReadCallerProvider =
    Provider<Future<void> Function({String? notificationId})>((ref) {
  return ({String? notificationId}) async {
    await const ApiClient().patch('/notifications/read', body: {
      if (notificationId != null) 'notificationId': notificationId,
    });
    ref.invalidate(notificationsStreamProvider);
  };
});
