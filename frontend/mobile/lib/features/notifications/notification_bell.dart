import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'notifications_providers.dart';

/// Ikon lonceng dengan badge jumlah belum-terbaca; membuka layar notifikasi.
/// Ditaruh di `actions` AppBar layar utama.
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadCountProvider);
    return IconButton(
      tooltip: 'Notifikasi',
      onPressed: () => context.push('/notifications'),
      icon: unread > 0
          ? Badge(
              label: Text(unread > 99 ? '99+' : '$unread'),
              child: const Icon(Icons.notifications_outlined),
            )
          : const Icon(Icons.notifications_outlined),
    );
  }
}
