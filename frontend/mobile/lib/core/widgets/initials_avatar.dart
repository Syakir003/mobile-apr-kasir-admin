import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Avatar bulat berisi inisial nama — dipakai pada tabel transaksi dan daftar
/// pelanggan (frame 10:210).
///
/// Baris pertama pada desain memakai latar Teal Bright terang; sisanya memakai
/// abu kehijauan. Varian terang dipakai lewat [highlighted] supaya baris
/// teratas tetap menonjol seperti di desain.
class InitialsAvatar extends StatelessWidget {
  const InitialsAvatar({
    super.key,
    required this.name,
    this.size = 32,
    this.highlighted = false,
  });

  final String name;
  final double size;
  final bool highlighted;

  /// Maksimal dua huruf dari dua kata pertama — "PT Maju Jaya" → "PT".
  static String initialsOf(String name) {
    final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
    if (words.isEmpty) return '?';
    final letters = words.take(2).map((w) => w.characters.first.toUpperCase());
    return letters.join();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: highlighted
            ? AppColors.avatarHighlight
            : AppColors.avatarSurface,
        shape: BoxShape.circle,
      ),
      child: Text(
        initialsOf(name),
        style: TextStyle(
          fontFamily: AppFonts.body,
          fontSize: size * 0.375,
          height: 16 / 12,
          fontWeight: FontWeight.w700,
          color: highlighted ? AppColors.avatarHighlightInk : AppColors.textBody,
        ),
      ),
    );
  }
}
