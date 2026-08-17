import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/undian.dart';
import 'undian_providers.dart';

AppBadgeTone undianStatusTone(UndianStatus s) => switch (s) {
      UndianStatus.berjalan => AppBadgeTone.pending,
      UndianStatus.selesai => AppBadgeTone.success,
      UndianStatus.dibatalkan => AppBadgeTone.danger,
    };

/// Daftar undian (admin only — dijaga `redirect.dart`).
class UndianListScreen extends ConsumerWidget {
  const UndianListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(undianListProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Undian')),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('buat-undian'),
        onPressed: () => context.go('/undian/baru'),
        icon: const Icon(Icons.add),
        label: const Text('Buat Undian'),
      ),
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat undian'),
        data: (items) {
          if (items.isEmpty) {
            return const AppEmptyState(
              icon: Icons.card_giftcard_outlined,
              title: 'Belum ada undian',
              message: 'Buat undian untuk mulai mengumpulkan peserta.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (_, i) {
              final u = items[i];
              return AppCard(
                child: InkWell(
                  key: Key('undian-${u.id}'),
                  onTap: () => context.go('/undian/${u.id}'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(u.title,
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 15,
                                    color: AppColors.slate900)),
                          ),
                          StatusBadge.tone(undianStatusTone(u.status),
                              label: u.status.label),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Hadiah ${u.discountLabel} • ${u.winnerCount} pemenang',
                        style: const TextStyle(
                            color: AppColors.textBody, fontSize: 13),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
