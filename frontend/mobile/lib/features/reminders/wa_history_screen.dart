import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/wa_message.dart';
import 'reminder_providers.dart';

/// Riwayat pesan pengingat yang sudah selesai diproses — terkirim, gagal, atau
/// dibatalkan. Read-only; aksi kirim/batal hanya ada di layar antrean.
class WaHistoryScreen extends ConsumerWidget {
  const WaHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(waHistoryProvider);
    final names = ref.watch(waMemberNamesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Riwayat Pengingat')),
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) =>
            AppErrorState(error: e, title: 'Gagal memuat riwayat pengingat'),
        data: (items) {
          if (items.isEmpty) {
            return const AppEmptyState(
              icon: Icons.history,
              title: 'Belum ada riwayat',
              message: 'Pesan yang sudah dikirim, gagal, atau dibatalkan akan '
                  'tercatat di sini.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(waHistoryProvider),
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (_, i) => _HistoryCard(
                message: items[i],
                memberName: names[items[i].memberId] ?? items[i].memberName,
              ),
            ),
          );
        },
      ),
    );
  }
}

AppBadgeTone _statusTone(WaStatus s) => switch (s) {
      WaStatus.terkirim => AppBadgeTone.success,
      WaStatus.gagal => AppBadgeTone.danger,
      WaStatus.dibatalkan => AppBadgeTone.draft,
      WaStatus.pending => AppBadgeTone.pending,
    };

class _HistoryCard extends StatelessWidget {
  const _HistoryCard({required this.message, required this.memberName});

  final WaMessage message;
  final String memberName;

  @override
  Widget build(BuildContext context) {
    final msg = message;
    final when = msg.sentAt ?? msg.createdAt;
    final reason = (msg.error ?? '').trim();

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  memberName.isEmpty ? 'Pelanggan' : memberName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              const SizedBox(width: 12),
              StatusBadge.tone(_statusTone(msg.status), label: msg.status.label),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            [
              msg.kind.label,
              if (when != null) formatTanggalPanjang(when),
            ].join(' • '),
            style: const TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 12,
              height: 16 / 12,
              color: AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.mist,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Text(
              msg.body,
              style: const TextStyle(
                fontFamily: AppFonts.body,
                fontSize: 13,
                height: 18 / 13,
                color: AppColors.textBody,
              ),
            ),
          ),
          if (msg.status == WaStatus.dibatalkan && reason.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Alasan: $reason',
              style: const TextStyle(
                fontFamily: AppFonts.body,
                fontSize: 12,
                height: 16 / 12,
                color: AppColors.textMuted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
