import 'package:flutter/material.dart';

/// Lapisan gerak design system.
///
/// Sebelum file ini ada, aplikasi praktis tanpa animasi: perpindahan halaman
/// memakai transisi bawaan Material, kartu tidak memberi respons saat disentuh,
/// dan status memuat berganti ke data secara mendadak. Warna & tipografi sudah
/// sesuai Figma, tapi hasilnya tetap terasa kaku karena tidak ada satu pun
/// perubahan yang terjadi bertahap.
///
/// Semua durasi di bawah sengaja pendek. Animasi pada aplikasi kasir dipakai
/// untuk menjelaskan perubahan, bukan untuk dinikmati — kasir menekan tombol
/// yang sama ratusan kali sehari, jadi apa pun di atas ~350ms akan terasa
/// lambat, bukan halus.
abstract final class AppDurations {
  /// Umpan balik sentuh — harus terasa seketika.
  static const quick = Duration(milliseconds: 120);

  /// Perubahan state biasa: hover, seleksi, cross-fade memuat → data.
  static const base = Duration(milliseconds: 220);

  /// Transisi halaman dan munculnya konten pertama kali.
  static const slow = Duration(milliseconds: 340);

  /// Jeda antar-item pada animasi bertahap (lihat [AppRevealIn.at]).
  static const stagger = Duration(milliseconds: 55);
}

abstract final class AppCurves {
  /// Standar: cepat di awal, melambat di akhir.
  static const standard = Curves.easeOutCubic;

  /// Untuk elemen yang masuk layar — awalnya lebih tegas daripada [standard].
  static const emphasized = Cubic(0.2, 0, 0, 1);

  /// Untuk elemen yang keluar layar.
  static const exit = Curves.easeInCubic;
}

/// `true` bila animasi dekoratif harus dilewati: pengguna mengaktifkan
/// "kurangi gerak" di setelan sistem.
bool prefersReducedMotion(BuildContext context) =>
    MediaQuery.maybeDisableAnimationsOf(context) ?? false;

// -----------------------------------------------------------------------------
// Transisi halaman
// -----------------------------------------------------------------------------

/// Transisi antar-halaman: memudar sambil naik sedikit.
///
/// Transisi bawaan Material berbeda-beda per platform — zoom di Android,
/// geser-penuh di iOS/desktop — dan keduanya terasa berat untuk aplikasi yang
/// isinya berpindah antar-daftar. Satu transisi yang sama di semua platform
/// juga membuat versi web (dipakai untuk pratinjau) tidak terasa asing.
class AppPageTransitionsBuilder extends PageTransitionsBuilder {
  const AppPageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T>? route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (prefersReducedMotion(context)) return child;
    return _AppPageTransition(animation: animation, child: child);
  }
}

class _AppPageTransition extends StatefulWidget {
  const _AppPageTransition({required this.animation, required this.child});

  final Animation<double> animation;
  final Widget child;

  @override
  State<_AppPageTransition> createState() => _AppPageTransitionState();
}

class _AppPageTransitionState extends State<_AppPageTransition> {
  late CurvedAnimation _curved = _curve();

  CurvedAnimation _curve() => CurvedAnimation(
        parent: widget.animation,
        curve: AppCurves.emphasized,
        reverseCurve: AppCurves.exit,
      );

  @override
  void didUpdateWidget(covariant _AppPageTransition oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.animation != widget.animation) {
      _curved.dispose();
      _curved = _curve();
    }
  }

  @override
  void dispose() {
    _curved.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.025),
          end: Offset.zero,
        ).animate(_curved),
        child: widget.child,
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// Umpan balik sentuh
// -----------------------------------------------------------------------------

/// Membungkus permukaan yang bisa ditekan agar bereaksi: mengecil sedikit saat
/// ditekan dan terangkat saat kursor melintas.
///
/// Riak Material saja tidak cukup — di kartu besar riaknya nyaris tak terlihat,
/// jadi kartu terasa seperti gambar mati. Skala kecil pada seluruh permukaan
/// jauh lebih terbaca dan tetap murah karena hanya menyentuh layer transform.
///
/// [onTap] boleh null; widget lalu meneruskan [child] apa adanya tanpa
/// menambah satu pun layer.
class AppPressable extends StatefulWidget {
  const AppPressable({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.borderRadius,
    this.pressedScale = 0.98,
    this.hoverLift = 2,
    this.splash = true,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// Bentuk riak & area klik. Default mengikuti radius kartu.
  final BorderRadius? borderRadius;

  /// Skala saat ditekan. 1 mematikan efeknya.
  final double pressedScale;

  /// Jarak angkat (px) saat kursor melintas. Tidak berpengaruh di layar sentuh.
  final double hoverLift;

  /// Riak Material di dalam permukaan. Matikan untuk permukaan gelap/gradient
  /// yang riaknya justru mengotori warna.
  final bool splash;

  @override
  State<AppPressable> createState() => _AppPressableState();
}

class _AppPressableState extends State<AppPressable> {
  bool _pressed = false;
  bool _hovered = false;

  void _setPressed(bool value) {
    if (_pressed != value) setState(() => _pressed = value);
  }

  void _setHovered(bool value) {
    if (_hovered != value) setState(() => _hovered = value);
  }

  @override
  Widget build(BuildContext context) {
    if (widget.onTap == null && widget.onLongPress == null) return widget.child;

    final radius =
        widget.borderRadius ?? BorderRadius.circular(AppMotionDefaults.radius);
    final reduced = prefersReducedMotion(context);

    final interactive = Material(
      type: MaterialType.transparency,
      borderRadius: radius,
      child: InkWell(
        onTap: widget.onTap,
        onLongPress: widget.onLongPress,
        onHighlightChanged: _setPressed,
        onHover: _setHovered,
        borderRadius: radius,
        // Riak dibuat sangat tipis: skala + angkat sudah jadi umpan balik
        // utamanya, riak pekat di atasnya membuat kartu terlihat berkedip.
        splashColor: widget.splash
            ? const Color(0x140B6B62)
            : Colors.transparent,
        highlightColor: Colors.transparent,
        hoverColor: Colors.transparent,
        child: widget.child,
      ),
    );

    if (reduced) return interactive;

    final scaled = AnimatedScale(
      scale: _pressed ? widget.pressedScale : 1,
      duration: AppDurations.quick,
      curve: AppCurves.standard,
      child: interactive,
    );

    if (widget.hoverLift == 0) return scaled;

    return TweenAnimationBuilder<double>(
      tween: Tween<double>(
        end: _hovered && !_pressed ? -widget.hoverLift : 0,
      ),
      duration: AppDurations.base,
      curve: AppCurves.standard,
      builder: (context, dy, child) =>
          Transform.translate(offset: Offset(0, dy), child: child),
      child: scaled,
    );
  }
}

/// Nilai default yang dipakai widget gerak agar tidak perlu mengimpor
/// `app_theme.dart` (yang sebaliknya mengimpor file ini untuk transisi halaman).
abstract final class AppMotionDefaults {
  static const radius = 20.0;
}

// -----------------------------------------------------------------------------
// Kemunculan konten
// -----------------------------------------------------------------------------

/// Memunculkan [child] dengan memudar sambil naik.
///
/// Dipakai untuk bagian halaman dan item daftar. Dengan [delay] berjenjang,
/// isi halaman "tersusun" alih-alih muncul sekaligus sebagai satu blok kaku.
///
/// Animasinya sekali jalan dan memakai satu [AnimationController] ber-[Interval]
/// — bukan `Timer` — supaya tidak ada timer menggantung saat widget dibuang di
/// tengah animasi (penyebab umum uji widget gagal).
class AppRevealIn extends StatefulWidget {
  const AppRevealIn({
    super.key,
    required this.child,
    this.delay = Duration.zero,
    this.rise = 14,
  });

  /// Pembantu untuk item ke-[index] dalam satu daftar: jeda naik bertahap
  /// untuk [maxStaggered] item pertama saja.
  ///
  /// Item setelah ambang itu dikembalikan apa adanya — di `ListView` yang malas
  /// membangun isinya, item ke-30 baru dibangun ketika pengguna menggulir ke
  /// sana, dan memunculkannya perlahan di saat itu terbaca sebagai daftar yang
  /// lambat, bukan sebagai animasi.
  static Widget at(
    int index, {
    Key? key,
    required Widget child,
    double rise = 14,
    int maxStaggered = 8,
  }) {
    if (index >= maxStaggered) return child;
    return AppRevealIn(
      key: key,
      delay: AppDurations.stagger * index,
      rise: rise,
      child: child,
    );
  }

  final Widget child;
  final Duration delay;

  /// Jarak (px) elemen naik dari posisi akhirnya.
  final double rise;

  @override
  State<AppRevealIn> createState() => _AppRevealInState();
}

class _AppRevealInState extends State<AppRevealIn>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _progress;

  @override
  void initState() {
    super.initState();
    final total = widget.delay + AppDurations.slow;
    _controller = AnimationController(vsync: this, duration: total);
    final start = widget.delay.inMilliseconds / total.inMilliseconds;
    _progress = CurvedAnimation(
      parent: _controller,
      curve: Interval(start, 1, curve: AppCurves.emphasized),
    );
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (prefersReducedMotion(context)) return widget.child;

    return AnimatedBuilder(
      animation: _progress,
      child: widget.child,
      builder: (context, child) {
        final t = _progress.value;
        return Opacity(
          opacity: t,
          child: Transform.translate(
            offset: Offset(0, (1 - t) * widget.rise),
            child: child,
          ),
        );
      },
    );
  }
}

/// Cross-fade antar-state dengan pergeseran kecil.
///
/// Pengganti penggantian widget mendadak (mis. spinner → tabel, atau nilai
/// metrik yang berubah karena realtime). [switchKey] harus berubah saat isinya
/// berganti; bila null, `child.key` yang dipakai.
class AppSwap extends StatelessWidget {
  const AppSwap({
    super.key,
    required this.child,
    this.switchKey,
    this.alignment = Alignment.topLeft,
    this.duration = AppDurations.base,
  });

  final Widget child;
  final Object? switchKey;
  final AlignmentGeometry alignment;
  final Duration duration;

  @override
  Widget build(BuildContext context) {
    if (prefersReducedMotion(context)) return child;

    return AnimatedSwitcher(
      duration: duration,
      switchInCurve: AppCurves.standard,
      switchOutCurve: AppCurves.exit,
      layoutBuilder: (currentChild, previousChildren) => Stack(
        alignment: alignment,
        children: [...previousChildren, if (currentChild != null) currentChild],
      ),
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, 0.06),
            end: Offset.zero,
          ).animate(animation),
          child: child,
        ),
      ),
      child: switchKey == null
          ? child
          : KeyedSubtree(key: ValueKey<Object>(switchKey!), child: child),
    );
  }
}
