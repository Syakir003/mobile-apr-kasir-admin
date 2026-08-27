import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_motion.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/adaptive_scaffold.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/page_header.dart';
import '../../data/models/app_user.dart';
import '../jobs/job_providers.dart';
import '../notifications/notification_bell.dart';
import '../pos/cart_state.dart' show formatRupiah;
import '../reports/reports_providers.dart';
import '../transactions/invoice_providers.dart';
import 'metric_card.dart';
import 'recent_transactions_card.dart';
import 'sales_trend_card.dart';

/// Lebar maksimum area konten — desain memakai canvas 1020px dengan padding
/// 40px, jadi isinya berhenti di 940px meski jendela lebih lebar.
const _contentMaxWidth = 940.0;

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).value;
    final role = user?.role;

    return Scaffold(
      appBar: AppBar(
        title: const Text('APR-POS'),
        actions: const [
          Padding(
            padding: EdgeInsets.only(right: 8),
            child: _RealtimeBadge(),
          ),
          NotificationBell(),
          SizedBox(width: 8),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          padding: EdgeInsets.all(AppSpacing.pageFor(constraints.maxWidth)),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: _contentMaxWidth),
              // Bagian halaman muncul berurutan dari atas ke bawah, bukan
              // serempak sebagai satu blok. Jenjangnya pendek (±55ms) — cukup
              // untuk memandu mata membaca dari header ke metrik ke tabel,
              // tidak sampai terasa sebagai menunggu.
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AppRevealIn.at(
                    0,
                    child: PageHeader(
                      title: 'Dashboard',
                      subtitle: formatTanggalPanjang(DateTime.now()),
                      subtitleIcon: Icons.calendar_today_outlined,
                      action: role == UserRole.teknisi
                          ? null
                          : PageHeaderAction(
                              icon: Icons.download_outlined,
                              label: 'Ekspor Laporan',
                              onPressed: () => context.go('/laporan'),
                            ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.section),
                  AppRevealIn.at(1, child: _Metrics(role: role)),
                  if (role != UserRole.teknisi) ...[
                    const SizedBox(height: AppSpacing.section),
                    AppRevealIn.at(2, child: const _SalesTrend()),
                    const SizedBox(height: AppSpacing.section),
                    AppRevealIn.at(3, child: const _RecentTransactions()),
                  ],
                  const SizedBox(height: AppSpacing.section),
                  AppRevealIn.at(4, child: _QuickAccess(role: role)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Grid kartu metrik. Kartu pertama selalu varian gradient sesuai desain.
///
/// Error sengaja disembunyikan agar dashboard tetap tampil untuk peran yang
/// tidak berhak membaca tabel finansial.
class _Metrics extends ConsumerWidget {
  const _Metrics({required this.role});
  final UserRole? role;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (role == null) return const SizedBox.shrink();

    if (role == UserRole.teknisi) {
      final jobs = ref.watch(jobsForCurrentUserProvider).value ?? const [];
      final aktif = jobs.where((j) => j.status.isActive).length;
      final selesai = jobs.length - aktif;
      return _grid([
        MetricCard(
          label: 'Job Berjalan',
          value: '$aktif',
          icon: Icons.handyman_outlined,
          sub: 'Dari ${jobs.length} job ditugaskan',
          featured: true,
          onTap: () => context.go('/jobs'),
        ),
        MetricCard(
          label: 'Job Selesai',
          value: '$selesai',
          icon: Icons.task_alt,
          sub: 'Total sepanjang waktu',
          onTap: () => context.go('/jobs'),
        ),
      ]);
    }

    final async = ref.watch(analyticsProvider);
    return AppSwap(
      switchKey: async.hasValue ? 'data' : 'loading',
      child: async.when(
        // Kerangka berbentuk kartu, bukan spinner: tata letak dashboard sudah
        // terlihat sejak awal sehingga yang berubah hanya angkanya.
        loading: () => const AppSkeletonCards(),
        error: (_, __) => const SizedBox.shrink(),
        data: (a) => _grid([
          MetricCard(
            label: 'Penjualan Hari Ini',
            value: formatRupiah(a.salesToday),
            icon: Icons.trending_up,
            sub: '${a.txToday} transaksi',
            featured: true,
            mono: true,
          ),
          MetricCard(
            label: 'Transaksi Hari Ini',
            value: '${a.txToday}',
            icon: Icons.shopping_cart_outlined,
            sub: '${a.txMonth} bulan ini',
            onTap: () => context.go('/transactions'),
          ),
          MetricCard(
            label: 'Belum Lunas',
            value: '${a.unpaidCount}',
            icon: Icons.receipt_long_outlined,
            sub: 'Piutang ${formatRupiah(a.piutang)}',
            badge: a.unpaidCount > 0 ? const MetricAlertBadge() : null,
            onTap: () => context.go('/transactions'),
          ),
          MetricCard(
            label: 'Stok Menipis',
            value: '${a.lowStock.length}',
            icon: Icons.inventory_outlined,
            sub: 'Item di bawah stok minimum',
            badge: a.lowStock.isNotEmpty
                ? const MetricAlertBadge(label: 'CEK STOK')
                : null,
            onTap: () => context.go('/stok'),
          ),
        ]),
      ),
    );
  }

  Widget _grid(List<Widget> tiles) {
    return GridView(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      // Desain menaruh 4 kartu sejajar pada canvas 940px → ±220px per kartu.
      // `mainAxisExtent` dipakai (bukan rasio) karena tinggi kartu tidak
      // bergantung lebar kolom. Desain menyebut minimal 140px, tapi isinya
      // (label 2 baris + angka 32/40 + sub-teks + padding 24) butuh 168px;
      // memaksa 140px membuat kartu overflow.
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 260,
        mainAxisExtent: 168,
        mainAxisSpacing: AppSpacing.grid,
        crossAxisSpacing: AppSpacing.grid,
      ),
      children: tiles,
    );
  }
}

class _SalesTrend extends ConsumerWidget {
  const _SalesTrend();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ref.watch(analyticsProvider).maybeWhen(
          data: (a) => SalesTrendCard(days: a.dailySales),
          orElse: () => const SizedBox.shrink(),
        );
  }
}

class _RecentTransactions extends ConsumerWidget {
  const _RecentTransactions();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ref.watch(invoicesStreamProvider).maybeWhen(
          data: (list) => RecentTransactionsCard(invoices: list),
          orElse: () => const SizedBox.shrink(),
        );
  }
}

/// Pintasan ke modul lain. Tidak ada di desain desktop — sidebar sudah memuat
/// semuanya — tapi dipertahankan karena di layar sempit bottom nav cuma
/// menampilkan 4 destinasi sebelum sisanya masuk menu "Lainnya".
class _QuickAccess extends StatelessWidget {
  const _QuickAccess({required this.role});
  final UserRole? role;

  @override
  Widget build(BuildContext context) {
    final shortcuts =
        destinationsForRole(role).where((d) => d.route != '/').toList();
    if (shortcuts.isEmpty) return const SizedBox.shrink();

    return AppSectionCard(
      title: 'Akses Cepat',
      child: Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          for (final (i, s) in shortcuts.indexed)
            AppRevealIn.at(
              i,
              rise: 8,
              child: _ShortcutChip(
                icon: s.icon,
                label: s.label,
                onTap: () => context.go(s.route),
              ),
            ),
        ],
      ),
    );
  }
}

class _ShortcutChip extends StatelessWidget {
  const _ShortcutChip({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    const radius = BorderRadius.all(Radius.circular(AppRadius.pill));

    return AppPressable(
      onTap: onTap,
      borderRadius: radius,
      // Pil kecil: cukup diangkat sedikit, skala besar malah terlihat melompat.
      pressedScale: 0.96,
      hoverLift: 1,
      child: Ink(
        decoration: const BoxDecoration(
          color: AppColors.mist,
          borderRadius: radius,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 18, color: AppColors.tealDeep),
              const SizedBox(width: 8),
              Text(
                label,
                style: const TextStyle(
                  fontFamily: AppFonts.display,
                  fontSize: 14,
                  height: 20 / 14,
                  fontWeight: FontWeight.w500,
                  color: AppColors.tealDeep,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Penanda bahwa data dashboard mengalir realtime dari Supabase.
class _RealtimeBadge extends StatelessWidget {
  const _RealtimeBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.successSurface,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 6,
            height: 6,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: AppColors.successGreen,
                shape: BoxShape.circle,
              ),
            ),
          ),
          SizedBox(width: 6),
          Text(
            'Realtime',
            style: TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 12,
              height: 16 / 12,
              fontWeight: FontWeight.w500,
              color: AppColors.successGreen,
            ),
          ),
        ],
      ),
    );
  }
}
