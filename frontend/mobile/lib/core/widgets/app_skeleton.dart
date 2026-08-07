import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../theme/app_motion.dart';
import '../theme/app_theme.dart';
import '../utils/error_message.dart';

/// Blok abu-abu berkilau sebagai pengganti spinner saat data belum datang.
///
/// Spinner di tengah layar kosong membuat perpindahan ke data terasa patah:
/// layar kosong → lompat ke daftar penuh. Kerangka yang bentuknya menyerupai
/// isi akhir membuat tata letak sudah terlihat sejak awal, jadi yang berubah
/// hanya isinya.
class AppSkeleton extends StatefulWidget {
  const AppSkeleton({
    super.key,
    this.width,
    this.height = 14,
    this.radius = AppRadius.sm,
    this.widthFactor,
  });

  /// Lebar tetap. Bila null, mengisi lebar induk (atau [widthFactor] darinya).
  final double? width;
  final double height;
  final double radius;

  /// Pecahan lebar induk (0..1) — berguna untuk baris teks yang panjangnya
  /// bervariasi supaya kerangka tidak terlihat seperti tabel.
  final double? widthFactor;

  @override
  State<AppSkeleton> createState() => _AppSkeletonState();
}

class _AppSkeletonState extends State<AppSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(widget.radius);

    Widget box(BoxDecoration decoration) {
      final sized = SizedBox(
        width: widget.width,
        height: widget.height,
        child: DecoratedBox(decoration: decoration),
      );
      if (widget.widthFactor == null) return sized;
      return FractionallySizedBox(
        alignment: Alignment.centerLeft,
        widthFactor: widget.widthFactor,
        child: sized,
      );
    }

    if (prefersReducedMotion(context)) {
      _controller.stop();
      return box(
        BoxDecoration(color: AppColors.mist, borderRadius: radius),
      );
    }

    if (!_controller.isAnimating) _controller.repeat();

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        // Sorotan bergerak dari luar kiri ke luar kanan, jadi setiap blok
        // tampak dilewati satu kilau alih-alih berkedip serempak.
        final t = _controller.value;
        return box(
          BoxDecoration(
            borderRadius: radius,
            gradient: LinearGradient(
              begin: Alignment(t * 3 - 2, 0),
              end: Alignment(t * 3, 0),
              colors: const [
                AppColors.mist,
                Color(0xFFF7FCFB),
                AppColors.mist,
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Kerangka satu baris daftar: avatar persegi, dua baris teks, badge.
///
/// Bentuknya sengaja meniru `_MasterCard` dan kartu daftar lain supaya
/// pergantian ke data asli tidak menggeser tata letak.
class AppSkeletonList extends StatelessWidget {
  const AppSkeletonList({
    super.key,
    this.count = 6,
    this.padding = const EdgeInsets.fromLTRB(16, 8, 16, 16),
    this.hasLeading = true,
    this.shrinkWrap = false,
  });

  final int count;
  final EdgeInsetsGeometry padding;
  final bool hasLeading;

  /// Setel bila kerangka dipasang di dalam kolom yang tingginya tak terbatas
  /// (mis. sebagai satu bagian dari `ListView` layar detail).
  final bool shrinkWrap;

  @override
  Widget build(BuildContext context) {
    // Lebar baris judul dibuat berselang-seling supaya kerangkanya tidak
    // terlihat seperti grid yang justru menambah kesan kaku.
    const titleWidths = [0.55, 0.42, 0.62, 0.48, 0.58, 0.45];

    return ListView.separated(
      padding: padding,
      shrinkWrap: shrinkWrap,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, index) => AppRevealIn.at(
        index,
        rise: 8,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            boxShadow: AppShadows.metric,
          ),
          child: Row(
            children: [
              if (hasLeading) ...[
                const AppSkeleton(width: 44, height: 44, radius: AppRadius.md),
                const SizedBox(width: 14),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AppSkeleton(
                      height: 13,
                      widthFactor: titleWidths[index % titleWidths.length],
                    ),
                    const SizedBox(height: 8),
                    const AppSkeleton(height: 11, widthFactor: 0.78),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              const AppSkeleton(
                width: 58,
                height: 20,
                radius: AppRadius.pill,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Kerangka grid kartu (metrik dashboard, ringkasan laporan).
class AppSkeletonCards extends StatelessWidget {
  const AppSkeletonCards({
    super.key,
    this.count = 4,
    this.height = 168,
    this.maxCrossAxisExtent = 260,
  });

  final int count;
  final double height;
  final double maxCrossAxisExtent;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: maxCrossAxisExtent,
        mainAxisExtent: height,
        mainAxisSpacing: AppSpacing.grid,
        crossAxisSpacing: AppSpacing.grid,
      ),
      itemCount: count,
      itemBuilder: (context, index) => AppRevealIn.at(
        index,
        rise: 10,
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.xl),
            boxShadow: AppShadows.metric,
          ),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              AppSkeleton(height: 13, widthFactor: 0.62),
              AppSkeleton(height: 28, widthFactor: 0.5, radius: AppRadius.md),
              AppSkeleton(height: 11, widthFactor: 0.44),
            ],
          ),
        ),
      ),
    );
  }
}

/// Kerangka layar detail / formulir: judul, lalu beberapa blok kartu.
///
/// Dipakai di layar yang isinya bukan daftar seragam — detail transaksi, detail
/// job, laporan, profil — supaya kerangkanya tetap menyerupai isi akhir alih-alih
/// memaksakan bentuk daftar.
class AppSkeletonDetail extends StatelessWidget {
  const AppSkeletonDetail({
    super.key,
    this.blocks = 3,
    this.padding = const EdgeInsets.fromLTRB(20, 20, 20, 24),
  });

  /// Jumlah blok kartu di bawah judul.
  final int blocks;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    // Tinggi blok dibuat berbeda-beda: tiga kotak dengan tinggi identik justru
    // membaca sebagai tabel kosong, bukan sebagai halaman yang sedang dimuat.
    // 96 tidak cukup: isi Column di bawah setinggi 58 + padding 40 = 98.
    const heights = [120.0, 168.0, 104.0, 140.0];

    return ListView(
      padding: padding,
      physics: const NeverScrollableScrollPhysics(),
      children: [
        const AppRevealIn(
          child: AppSkeleton(height: 26, widthFactor: 0.5, radius: AppRadius.md),
        ),
        const SizedBox(height: 8),
        const AppRevealIn(
          delay: AppDurations.stagger,
          child: AppSkeleton(height: 13, widthFactor: 0.32),
        ),
        const SizedBox(height: AppSpacing.section),
        for (var i = 0; i < blocks; i++) ...[
          if (i > 0) const SizedBox(height: AppSpacing.grid),
          AppRevealIn.at(
            i + 2,
            rise: 10,
            child: Container(
              height: heights[i % heights.length],
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(AppRadius.xl),
                boxShadow: AppShadows.metric,
              ),
              padding: const EdgeInsets.all(20),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppSkeleton(height: 14, widthFactor: 0.4),
                  SizedBox(height: 14),
                  AppSkeleton(height: 11, widthFactor: 0.85),
                  SizedBox(height: 8),
                  AppSkeleton(height: 11, widthFactor: 0.6),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// Menampilkan [value] dengan cross-fade antara kerangka, pesan galat, dan data.
///
/// Menggantikan pola `async.when(loading: CircularProgressIndicator(), ...)`
/// yang berulang di puluhan layar dan selalu berganti secara mendadak.
class AppAsyncView<T> extends StatelessWidget {
  const AppAsyncView({
    super.key,
    required this.value,
    required this.data,
    required this.skeleton,
    this.onRetry,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;

  /// Tampilan saat memuat — biasanya [AppSkeletonList] atau [AppSkeletonCards].
  final Widget skeleton;

  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    // `value.when` tidak dipakai karena saat data lama masih ada (refresh
    // realtime) kerangka justru mengganggu — data lama tetap ditampilkan.
    final Widget child;
    final Object key;
    if (value.hasValue) {
      key = 'data';
      child = data(value.requireValue);
    } else if (value.hasError) {
      key = 'error';
      child = _ErrorView(error: value.error!, onRetry: onRetry);
    } else {
      key = 'loading';
      child = skeleton;
    }

    return AppSwap(switchKey: key, child: child);
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.cloud_off_outlined,
              size: 32,
              color: AppColors.textMuted,
            ),
            const SizedBox(height: 12),
            Text(
              'Gagal memuat data.\n${errorMessage(error)}',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.body,
                fontSize: 13,
                height: 18 / 13,
                color: AppColors.textMuted,
              ),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 16),
                label: const Text('Coba lagi'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
