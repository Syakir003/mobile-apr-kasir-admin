import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/app_user.dart';
import '../../data/models/wa_message.dart';
import 'reminder_providers.dart';

/// Layar utama Pengingat: pesan WhatsApp yang GAGAL terkirim.
///
/// Pengingat & notifikasi WA dikirim otomatis oleh server (Fonnte), sama seperti
/// web — tidak ada lagi antrean kirim manual. Yang perlu perhatian hanya pesan
/// gagal (mis. nomor salah, layanan WA sedang gangguan); admin bisa mengirim ulang.
/// Semua pesan (terkirim/gagal/dibatalkan) ada di Riwayat.
class WaOutboxScreen extends ConsumerWidget {
  const WaOutboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(waFailedProvider);
    final names = ref.watch(waMemberNamesProvider);
    final isAdmin = ref.watch(currentUserProvider).value?.role == UserRole.admin;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pengingat'),
        actions: [
          IconButton(
            key: const Key('open-schedule'),
            icon: const Icon(Icons.event_note_outlined),
            tooltip: 'Monitoring jadwal servis',
            onPressed: () => context.go('/pengingat/jadwal'),
          ),
          IconButton(
            key: const Key('buka-riwayat'),
            icon: const Icon(Icons.history),
            tooltip: 'Riwayat pengingat',
            onPressed: () => context.go('/pengingat/riwayat'),
          ),
          if (isAdmin)
            IconButton(
              key: const Key('buka-pengaturan'),
              icon: const Icon(Icons.tune),
              tooltip: 'Pengaturan pengingat',
              onPressed: () => context.go('/pengingat/pengaturan'),
            ),
        ],
      ),
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) =>
            AppErrorState(error: e, title: 'Gagal memuat pesan WhatsApp'),
        data: (items) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(waFailedProvider),
          child: items.isEmpty
              ? ListView(
                  // Tetap bisa ditarik untuk refresh walau kosong.
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: const [
                    AppEmptyState(
                      icon: Icons.mark_chat_read_outlined,
                      title: 'Tidak ada pesan gagal',
                      message: 'Pengingat dikirim otomatis lewat WhatsApp. Pesan '
                          'yang gagal terkirim akan muncul di sini.',
                    ),
                  ],
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => _WaCard(
                    message: items[i],
                    memberName: names[items[i].memberId] ?? items[i].memberName,
                    canRetry: isAdmin,
                  ),
                ),
        ),
      ),
    );
  }
}

/// Nada badge per jenis pesan: konfirmasi selesai bernada positif, H-3
/// mengingatkan (kuning), H+7 sudah lewat tenggat (merah).
AppBadgeTone waKindTone(WaKind kind) => switch (kind) {
      WaKind.selesaiServis => AppBadgeTone.success,
      WaKind.reminderH3 => AppBadgeTone.pending,
      WaKind.reminderH7 => AppBadgeTone.danger,
      WaKind.menangUndian => AppBadgeTone.success,
      WaKind.voucherBaru => AppBadgeTone.success,
      WaKind.invoice => AppBadgeTone.draft,
    };

class _WaCard extends ConsumerStatefulWidget {
  const _WaCard({required this.message, required this.memberName, required this.canRetry});

  final WaMessage message;
  final String memberName;
  final bool canRetry;

  @override
  ConsumerState<_WaCard> createState() => _WaCardState();
}

class _WaCardState extends ConsumerState<_WaCard> {
  bool _busy = false;

  void _snack(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: error ? AppColors.danger : null,
      ),
    );
  }

  Future<void> _kirimUlang() async {
    setState(() => _busy = true);
    try {
      await ref.read(retryWaCallerProvider)(widget.message.id);
      ref.invalidate(waFailedProvider);
      ref.invalidate(waHistoryProvider);
      if (!mounted) return;
      _snack('Pesan dikirim ulang.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal mengirim ulang: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final msg = widget.message;
    final due = msg.dueDate;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  widget.memberName.isEmpty ? 'Pelanggan' : widget.memberName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              const SizedBox(width: 12),
              StatusBadge.tone(waKindTone(msg.kind), label: msg.kind.label),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            [
              if (msg.unitCount > 0) '${msg.unitCount} unit AC',
              if (due != null) 'jatuh tempo ${formatTanggalPanjang(due)}',
            ].join(' • '),
            style: const TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 12,
              height: 16 / 12,
              color: AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 12),
          // Cuplikan isi pesan: admin perlu tahu apa yang akan terkirim sebelum
          // membuka WhatsApp, tapi pesan utuhnya terlalu panjang untuk kartu.
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.mist,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Text(
              msg.body,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontFamily: AppFonts.body,
                fontSize: 13,
                height: 18 / 13,
                color: AppColors.textBody,
              ),
            ),
          ),
          if ((msg.error ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              'Alasan gagal: ${msg.error!.trim()}',
              style: const TextStyle(
                fontFamily: AppFonts.body,
                fontSize: 12,
                height: 16 / 12,
                color: AppColors.danger,
              ),
            ),
          ],
          if (widget.canRetry) ...[
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                key: Key('kirim-ulang-${msg.id}'),
                onPressed: _busy ? null : _kirimUlang,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Kirim ulang'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
