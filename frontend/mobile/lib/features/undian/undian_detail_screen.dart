import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/member.dart';
import '../../data/models/undian.dart';
import '../pos/member_picker_sheet.dart';
import '../reminders/reminder_providers.dart' show waMemberNamesProvider;
import 'undian_list_screen.dart' show undianStatusTone;
import 'undian_providers.dart';

/// Detail satu undian: peserta (tambah/hapus manual selama `berjalan`),
/// tombol Tarik Undian, tombol Batalkan.
class UndianDetailScreen extends ConsumerStatefulWidget {
  const UndianDetailScreen({super.key, required this.undianId});

  final String undianId;

  @override
  ConsumerState<UndianDetailScreen> createState() => _UndianDetailScreenState();
}

class _UndianDetailScreenState extends ConsumerState<UndianDetailScreen> {
  bool _busy = false;

  void _snack(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(text),
      backgroundColor: error ? AppColors.danger : null,
    ));
  }

  Future<void> _addParticipant() async {
    final picked = await showModalBottomSheet<Member>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const MemberPickerSheet(),
    );
    if (picked == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(updateUndianParticipantsCallerProvider)(
          widget.undianId,
          add: [picked.id]);
      if (!mounted) return;
      _snack('${picked.name} ditambahkan.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal menambah peserta: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeParticipant(String memberId, String name) async {
    setState(() => _busy = true);
    try {
      await ref.read(updateUndianParticipantsCallerProvider)(
          widget.undianId,
          remove: [memberId]);
      if (!mounted) return;
      _snack('$name dihapus dari peserta.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal menghapus peserta: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _draw() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Tarik undian?'),
        content: const Text(
          'Pemenang dipilih acak dan tidak bisa diulang. Kode voucher langsung '
          'dibuat dan antre dikirim lewat WhatsApp di layar Pengingat.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Batal'),
          ),
          FilledButton(
            key: const Key('konfirmasi-tarik'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Tarik Sekarang'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final winnerCount = await ref.read(drawUndianCallerProvider)(widget.undianId);
      if (!mounted) return;
      _snack('$winnerCount pemenang terpilih.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal menarik undian: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Batalkan undian?'),
        content: const Text('Undian ini tidak akan bisa ditarik.'),
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
    try {
      await ref.read(cancelUndianCallerProvider)(widget.undianId);
      if (!mounted) return;
      _snack('Undian dibatalkan.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal membatalkan: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final undianAsync = ref.watch(undianListProvider);
    final participantsAsync =
        ref.watch(undianParticipantsProvider(widget.undianId));
    final names = ref.watch(waMemberNamesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Detail Undian')),
      body: undianAsync.when(
        loading: () => const AppSkeletonDetail(blocks: 2),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat undian'),
        data: (list) {
          Undian? undian;
          for (final u in list) {
            if (u.id == widget.undianId) {
              undian = u;
              break;
            }
          }
          if (undian == null) {
            return const AppEmptyState(
              icon: Icons.card_giftcard_outlined,
              title: 'Undian tidak ditemukan',
            );
          }
          final berjalan = undian.status == UndianStatus.berjalan;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(undian.title,
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 17,
                                  color: AppColors.slate900)),
                        ),
                        StatusBadge.tone(undianStatusTone(undian.status),
                            label: undian.status.label),
                      ],
                    ),
                    if (undian.description != null &&
                        undian.description!.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(undian.description!,
                          style: const TextStyle(color: AppColors.textBody)),
                    ],
                    const SizedBox(height: 8),
                    Text(
                      'Hadiah ${undian.discountLabel} • ${undian.winnerCount} pemenang '
                      '• voucher berlaku ${undian.voucherValidDays} hari',
                      style: const TextStyle(
                          color: AppColors.textMuted, fontSize: 13),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.grid),
              Row(
                children: [
                  const Text('Peserta',
                      style: TextStyle(
                          fontWeight: FontWeight.w600, color: AppColors.slate900)),
                  const Spacer(),
                  if (berjalan)
                    TextButton.icon(
                      onPressed: _busy ? null : _addParticipant,
                      icon: const Icon(Icons.person_add_alt_outlined, size: 18),
                      label: const Text('Tambah'),
                    ),
                ],
              ),
              participantsAsync.when(
                loading: () => const AppSkeletonList(hasLeading: false),
                error: (e, _) =>
                    AppErrorState(error: e, title: 'Gagal memuat peserta'),
                data: (participants) {
                  if (participants.isEmpty) {
                    return const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text('Belum ada peserta.',
                          style: TextStyle(color: AppColors.textMuted)),
                    );
                  }
                  return Column(
                    children: [
                      for (final p in participants)
                        ListTile(
                          key: Key('peserta-${p.memberId}'),
                          contentPadding: EdgeInsets.zero,
                          title: Text(names[p.memberId] ?? 'Pelanggan'),
                          subtitle: Text(p.source == 'manual'
                              ? 'Ditambahkan manual'
                              : 'Otomatis dari kriteria'),
                          trailing: berjalan
                              ? IconButton(
                                  icon: const Icon(Icons.close,
                                      color: AppColors.danger),
                                  onPressed: _busy
                                      ? null
                                      : () => _removeParticipant(
                                          p.memberId, names[p.memberId] ?? ''),
                                )
                              : null,
                        ),
                    ],
                  );
                },
              ),
              const SizedBox(height: AppSpacing.grid),
              if (berjalan) ...[
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    key: const Key('tarik-undian'),
                    onPressed: _busy ? null : _draw,
                    icon: const Icon(Icons.casino_outlined),
                    label: const Text('Tarik Undian'),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: _busy ? null : _cancel,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.danger,
                      side: const BorderSide(color: AppColors.dangerBorder),
                    ),
                    child: const Text('Batalkan Undian'),
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}
