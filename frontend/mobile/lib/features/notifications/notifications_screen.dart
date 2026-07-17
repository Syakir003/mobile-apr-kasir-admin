import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/app_notification.dart';
import 'notifications_providers.dart';

/// Daftar notifikasi in-app. Semua ditandai terbaca saat layar dibuka; ketuk
/// item job untuk membuka detail job terkait.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    // Tandai semua terbaca sekali saat layar terbuka (best-effort).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(markNotificationsReadCallerProvider)().catchError((_) {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(notificationsStreamProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifikasi')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Gagal memuat: $e')),
        data: (items) {
          if (items.isEmpty) {
            return const _EmptyState();
          }
          return ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: items.length,
            separatorBuilder: (_, __) =>
                const Divider(height: 1, indent: 68),
            itemBuilder: (_, i) => _NotificationTile(item: items[i]),
          );
        },
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.item});
  final AppNotification item;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (item.type) {
      'job_assigned' => (Icons.handyman_outlined, AppColors.teal600),
      'request_submitted' => (Icons.add_shopping_cart_outlined, AppColors.warning),
      'request_decided' => (Icons.fact_check_outlined, AppColors.success),
      _ => (Icons.notifications_outlined, AppColors.slate500),
    };
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: CircleAvatar(
        backgroundColor: color.withValues(alpha: 0.12),
        child: Icon(icon, color: color, size: 22),
      ),
      title: Text(item.title,
          style: TextStyle(
            fontWeight: item.read ? FontWeight.w500 : FontWeight.w700,
            color: AppColors.slate900,
          )),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (item.body.isNotEmpty)
            Text(item.body,
                style: const TextStyle(color: AppColors.slate600)),
          if (item.createdAt != null)
            Text(_relativeTime(item.createdAt!),
                style: const TextStyle(
                    color: AppColors.slate400, fontSize: 12)),
        ],
      ),
      trailing: item.read
          ? null
          : Container(
              width: 9,
              height: 9,
              decoration: const BoxDecoration(
                color: AppColors.teal600,
                shape: BoxShape.circle,
              ),
            ),
      onTap: () {
        if (item.type == 'job_assigned' && item.target != null) {
          context.push('/jobs/${item.target}');
        } else if (item.isRequest) {
          context.push('/jobs');
        }
      },
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.notifications_none, size: 56, color: AppColors.slate300),
          SizedBox(height: 12),
          Text('Belum ada notifikasi.',
              style: TextStyle(color: AppColors.slate500)),
        ],
      ),
    );
  }
}

String _relativeTime(DateTime t) {
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'Baru saja';
  if (d.inMinutes < 60) return '${d.inMinutes} mnt lalu';
  if (d.inHours < 24) return '${d.inHours} jam lalu';
  if (d.inDays < 7) return '${d.inDays} hari lalu';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(t.day)}-${two(t.month)}-${t.year}';
}
