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

/// Antrean pengingat servis yang menunggu dikirim ke pelanggan lewat WhatsApp.
///
/// Selama adapter pengiriman masih `manual` (lihat rencana Fase 8), layar inilah
/// pengirimnya: satu ketukan membuka WhatsApp dengan pesan sudah terisi penuh,
/// admin/kasir tinggal menekan Send. Redaksi pesan datang utuh dari
/// `build_wa_body()` di Postgres — klien tidak pernah menyusun ulang teksnya,
/// supaya yang dikirim hari ini identik dengan template yang nanti diajukan ke
/// Meta saat naik ke Cloud API.
class WaOutboxScreen extends ConsumerWidget {
  const WaOutboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(waOutboxStreamProvider);
    final names = ref.watch(waMemberNamesProvider);
    final isAdmin = ref.watch(currentUserProvider).value?.role == UserRole.admin;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pengingat'),
        actions: [
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
            AppErrorState(error: e, title: 'Gagal memuat antrean pengingat'),
        data: (items) {
          if (items.isEmpty) {
            return const AppEmptyState(
              icon: Icons.mark_chat_read_outlined,
              title: 'Tidak ada pesan menunggu',
              message: 'Pengingat baru muncul sendiri di sini saat pekerjaan '
                  'selesai atau saat jadwal servis pelanggan mendekat.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (_, i) => _WaCard(
              message: items[i],
              memberName: names[items[i].memberId] ?? items[i].memberName,
            ),
          );
        },
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
    };

class _WaCard extends ConsumerStatefulWidget {
  const _WaCard({required this.message, required this.memberName});

  final WaMessage message;
  final String memberName;

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

  /// Buka WhatsApp dulu, tandai terkirim belakangan.
  ///
  /// Urutannya penting: kalau statusnya ditandai lebih dulu lalu WhatsApp gagal
  /// terbuka, pesan itu hilang dari antrean tanpa pernah sampai ke pelanggan
  /// dan tidak ada yang menyadarinya.
  Future<void> _kirim() async {
    setState(() => _busy = true);
    final launch = ref.read(waLauncherProvider);
    final markSent = ref.read(markWaSentCallerProvider);
    try {
      final opened = await launch(widget.message.waUri);
      if (!mounted) return;
      if (!opened) {
        _snack('WhatsApp tidak terpasang di perangkat ini.', error: true);
        return;
      }
      await markSent(widget.message.id);
      if (!mounted) return;
      _snack('Pesan ditandai terkirim.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal mengirim: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _batalkan() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Batalkan pengingat?'),
        content: Text(
          'Pesan untuk ${widget.memberName} tidak akan dikirim dan tidak bisa '
          'dimunculkan kembali.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Tidak'),
          ),
          FilledButton(
            key: const Key('konfirmasi-batal'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Batalkan'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    final cancel = ref.read(cancelWaMessageCallerProvider);
    try {
      await cancel(widget.message.id);
      if (!mounted) return;
      _snack('Pengingat dibatalkan.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal membatalkan: ${errorMessage(e)}', error: true);
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
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  key: Key('kirim-${msg.id}'),
                  onPressed: _busy ? null : _kirim,
                  icon: const Icon(Icons.send_outlined, size: 18),
                  label: const Text('Kirim via WhatsApp'),
                ),
              ),
              const SizedBox(width: 12),
              OutlinedButton(
                key: Key('batal-${msg.id}'),
                onPressed: _busy ? null : _batalkan,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.danger,
                  side: const BorderSide(color: AppColors.dangerBorder),
                ),
                child: const Text('Batalkan'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
