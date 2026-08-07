import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/app_card.dart';
import '../pos/cart_state.dart' show formatRupiah;
import '../reports/reports_providers.dart' show DaySales;

/// Kartu "Tren Penjualan Mingguan" (bento grid 10:100).
///
/// Desain memakai grafik garis; di sini dipakai batang karena app belum punya
/// pustaka grafik dan batang bisa dirender dengan widget biasa tanpa menambah
/// dependensi. Garis bantu horizontal, label sumbu dalam juta, label hari, dan
/// penonjolan hari ini mengikuti desain.
class SalesTrendCard extends StatelessWidget {
  const SalesTrendCard({super.key, required this.days});

  /// Data harian, urut menaik. Hanya 7 entri terakhir yang ditampilkan.
  final List<DaySales> days;

  /// Tinggi area gambar (di luar label hari).
  static const _plotHeight = 160.0;

  /// Lebar kolom label sumbu kiri.
  static const _axisWidth = 44.0;

  @override
  Widget build(BuildContext context) {
    final shown = days.length > 7 ? days.sublist(days.length - 7) : days;

    if (shown.isEmpty) {
      return const AppSectionCard(
        title: 'Tren Penjualan Mingguan',
        child: SizedBox(
          height: 120,
          child: Center(
            child: Text(
              'Belum ada penjualan pekan ini.',
              style: TextStyle(color: AppColors.textMuted),
            ),
          ),
        ),
      );
    }

    final peak = shown.map((d) => d.total).reduce((a, b) => a > b ? a : b);
    // Skala dibulatkan ke atas ke kelipatan "bagus" agar label sumbu terbaca
    // rapi (mis. 24,3 juta → 30 juta dengan tiga garis bantu).
    final top = _niceCeiling(peak);
    final total = shown.fold<int>(0, (sum, d) => sum + d.total);
    final today = DateTime.now();

    return AppSectionCard(
      title: 'Tren Penjualan Mingguan',
      action: Text(
        formatRupiah(total),
        style: AppTextStyles.monoCode.copyWith(
          color: AppColors.tealDeep,
          fontWeight: FontWeight.w700,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: _plotHeight,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: _axisWidth,
                  child: _AxisLabels(top: top),
                ),
                Expanded(
                  child: Stack(
                    children: [
                      const Positioned.fill(child: _GridLines()),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          for (final d in shown)
                            Expanded(
                              child: _Bar(
                                ratio: top == 0 ? 0 : d.total / top,
                                isToday: _sameDay(d.date, today),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const SizedBox(width: _axisWidth),
              for (final d in shown)
                Expanded(
                  child: Text(
                    singkatanHari(d.date),
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: AppFonts.body,
                      fontSize: 12,
                      height: 16 / 12,
                      fontWeight: _sameDay(d.date, today)
                          ? FontWeight.w700
                          : FontWeight.w500,
                      color: _sameDay(d.date, today)
                          ? AppColors.tealDeep
                          : AppColors.textMuted,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  /// Cari langkah 1/2/5 × 10ⁿ terkecil yang membuat tiga langkah menutupi
  /// nilai puncak, lalu pakai 3× langkah itu sebagai batas atas.
  ///
  /// Membulatkan langkahnya (bukan batas atasnya) penting supaya keempat label
  /// sumbu jadi angka bulat — puncak 24,5jt menghasilkan 0/10jt/20jt/30jt,
  /// bukan 0/17jt/33jt/50jt.
  static int _niceCeiling(int value) {
    if (value <= 0) return 0;
    var unit = 1;
    while (unit * 30 < value) {
      unit *= 10;
    }
    for (final m in [1, 2, 5]) {
      if (unit * m * 3 >= value) return unit * m * 3;
    }
    return unit * 30;
  }
}

/// Empat label sumbu (0 … top) sejajar dengan garis bantu.
class _AxisLabels extends StatelessWidget {
  const _AxisLabels({required this.top});

  final int top;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        for (var i = 3; i >= 0; i--)
          Transform.translate(
            offset: const Offset(0, -6),
            child: Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Text(
                _short(top * i ~/ 3),
                style: const TextStyle(
                  fontFamily: AppFonts.mono,
                  fontSize: 10,
                  height: 12 / 10,
                  color: AppColors.textMuted,
                ),
              ),
            ),
          ),
      ],
    );
  }

  static String _short(int v) {
    if (v == 0) return '0';
    if (v >= 1000000000) return '${(v / 1000000000).toStringAsFixed(0)}M';
    if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(0)}jt';
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(0)}rb';
    return '$v';
  }
}

/// Tiga garis bantu putus-putus + garis dasar.
class _GridLines extends StatelessWidget {
  const _GridLines();

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        for (var i = 0; i < 4; i++)
          SizedBox(
            height: 1,
            child: CustomPaint(
              painter: _DashedLinePainter(
                color: i == 3 ? AppColors.hairline : AppColors.mist,
              ),
              child: const SizedBox.expand(),
            ),
          ),
      ],
    );
  }
}

class _DashedLinePainter extends CustomPainter {
  const _DashedLinePainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1;
    const dash = 4.0;
    const gap = 4.0;
    var x = 0.0;
    while (x < size.width) {
      canvas.drawLine(Offset(x, 0), Offset(x + dash, 0), paint);
      x += dash + gap;
    }
  }

  @override
  bool shouldRepaint(_DashedLinePainter oldDelegate) =>
      oldDelegate.color != color;
}

class _Bar extends StatelessWidget {
  const _Bar({required this.ratio, required this.isToday});

  final double ratio;
  final bool isToday;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: LayoutBuilder(
        builder: (context, constraints) => Align(
          alignment: Alignment.bottomCenter,
          // Batang selalu punya tinggi minimum agar hari tanpa penjualan tetap
          // terbaca sebagai kolom kosong, bukan hilang sama sekali.
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 450),
            curve: Curves.easeOutCubic,
            height: (constraints.maxHeight * ratio).clamp(4.0, 10000.0),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: isToday
                    ? const [AppColors.tealBright, AppColors.tealDeep]
                    : const [Color(0xFF5FD8C8), AppColors.tealBright],
              ),
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(AppRadius.sm),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
