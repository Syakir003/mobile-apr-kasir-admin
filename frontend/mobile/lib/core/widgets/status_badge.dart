import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Badge status sesuai style guide: pill, titik 6px, padding 12×4, teks Inter
/// Medium 12/16. Latar diturunkan dari warna teks pada alpha 10%.
///
/// Gantikan pill buatan tangan (`Container` + `withValues(alpha: 0.12)`) supaya
/// ukuran dan bobot teksnya seragam di seluruh aplikasi.
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.label,
    required this.color,
    this.background,
    this.dotColor,
    this.showDot = true,
    this.constrained = false,
  });

  /// Varian dengan nada baku style guide (Pending / Disetujui-Lunas / Ditolak /
  /// Draft).
  StatusBadge.tone(
    AppBadgeTone tone, {
    super.key,
    required this.label,
    this.showDot = true,
    this.constrained = false,
  })  : color = tone.foreground,
        background = tone.background,
        dotColor = tone.dot;

  final String label;

  /// Warna teks (dan titik, kecuali [dotColor] diisi).
  final Color color;

  /// Latar khusus. Kalau null, dipakai [color] pada alpha 10%.
  final Color? background;

  final Color? dotColor;
  final bool showDot;

  /// Biarkan label menyusut + elipsis saat ruang sempit (mis. di dalam sel
  /// tabel). Default `false` karena badge sering dipakai di dalam `Wrap` atau
  /// `Row` tanpa batas lebar, di mana anak `Flexible` justru melempar error.
  final bool constrained;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: background ?? color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showDot) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: dotColor ?? color,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 6),
          ],
          if (constrained)
            Flexible(child: _label())
          else
            _label(),
        ],
      ),
    );
  }

  Widget _label() => Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontFamily: AppFonts.body,
          fontSize: 12,
          height: 16 / 12,
          fontWeight: FontWeight.w500,
          color: color,
        ),
      );
}
