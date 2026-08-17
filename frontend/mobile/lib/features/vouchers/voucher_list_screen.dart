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
import '../../data/models/voucher.dart';
import '../reminders/reminder_providers.dart' show waMemberNamesProvider;
import 'voucher_providers.dart';

AppBadgeTone voucherStatusTone(VoucherStatus s) => switch (s) {
      VoucherStatus.aktif => AppBadgeTone.success,
      VoucherStatus.terpakai => AppBadgeTone.draft,
      VoucherStatus.kadaluarsa => AppBadgeTone.danger,
      VoucherStatus.dibatalkan => AppBadgeTone.danger,
    };

/// Daftar semua voucher (undian + ad-hoc). Admin membuat baru & membatalkan
/// yang masih aktif; kasir hanya melihat — pemakaian sesungguhnya lewat field
/// kode voucher di layar Checkout, bukan aksi di sini.
class VoucherListScreen extends ConsumerWidget {
  const VoucherListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(vouchersStreamProvider);
    final names = ref.watch(waMemberNamesProvider);
    final isAdmin = ref.watch(currentUserProvider).value?.role == UserRole.admin;

    return Scaffold(
      appBar: AppBar(title: const Text('Voucher')),
      floatingActionButton: isAdmin
          ? FloatingActionButton.extended(
              key: const Key('buat-voucher'),
              onPressed: () => context.go('/voucher/baru'),
              icon: const Icon(Icons.add),
              label: const Text('Buat Voucher'),
            )
          : null,
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat voucher'),
        data: (items) {
          if (items.isEmpty) {
            return const AppEmptyState(
              icon: Icons.confirmation_number_outlined,
              title: 'Belum ada voucher',
              message: 'Voucher muncul di sini setelah dibuat manual atau '
                  'setelah undian ditarik.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (_, i) => _VoucherCard(
              voucher: items[i],
              memberName: names[items[i].memberId] ?? 'Pelanggan',
              isAdmin: isAdmin,
            ),
          );
        },
      ),
    );
  }
}

class _VoucherCard extends ConsumerStatefulWidget {
  const _VoucherCard({
    required this.voucher,
    required this.memberName,
    required this.isAdmin,
  });

  final Voucher voucher;
  final String memberName;
  final bool isAdmin;

  @override
  ConsumerState<_VoucherCard> createState() => _VoucherCardState();
}

class _VoucherCardState extends ConsumerState<_VoucherCard> {
  bool _busy = false;

  Future<void> _batalkan() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Batalkan voucher?'),
        content: Text('Kode ${widget.voucher.code} tidak akan bisa dipakai lagi.'),
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
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(cancelVoucherCallerProvider)(widget.voucher.id);
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(content: Text('Voucher dibatalkan.')));
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text('Gagal membatalkan: ${errorMessage(e)}'),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.voucher;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(v.code,
                        style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                            color: AppColors.slate900)),
                    Text(widget.memberName,
                        style: const TextStyle(
                            color: AppColors.textMuted, fontSize: 13)),
                  ],
                ),
              ),
              StatusBadge.tone(voucherStatusTone(v.status), label: v.status.label),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${v.discountLabel} • berlaku sampai ${formatTanggalPanjang(v.expiresAt)}',
            style: const TextStyle(color: AppColors.textBody, fontSize: 13),
          ),
          if (widget.isAdmin && v.status == VoucherStatus.aktif) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                key: Key('batal-${v.id}'),
                onPressed: _busy ? null : _batalkan,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.danger,
                  side: const BorderSide(color: AppColors.dangerBorder),
                ),
                child: const Text('Batalkan'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
