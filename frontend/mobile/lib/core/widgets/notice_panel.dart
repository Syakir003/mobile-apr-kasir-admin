import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Nada panel pemberitahuan — memakai permukaan bernada dari style guide.
enum NoticeTone { info, warning, danger, success }

extension NoticeToneColors on NoticeTone {
  Color get surface => switch (this) {
        NoticeTone.info => AppColors.tealSurface,
        NoticeTone.warning => AppColors.amberSurface,
        NoticeTone.danger => AppColors.dangerSurface,
        NoticeTone.success => AppColors.successSurface,
      };

  Color get borderColor => switch (this) {
        NoticeTone.info => AppColors.tealBorder,
        NoticeTone.warning => AppColors.amberBorder,
        NoticeTone.danger => AppColors.dangerBorder,
        NoticeTone.success => AppColors.successBorder,
      };

  Color get ink => switch (this) {
        NoticeTone.info => AppColors.tealInk,
        NoticeTone.warning => AppColors.amberInk,
        NoticeTone.danger => AppColors.dangerInk,
        NoticeTone.success => AppColors.successInk,
      };
}

/// Panel pemberitahuan sebaris: latar bernada, garis tepi tipis, ikon opsional.
///
/// Dipakai untuk hint terkunci, peringatan stok kurang, dan pratinjau hasil —
/// menggantikan `Container` bertint yang sebelumnya memakai warna Tailwind
/// hardcoded di tiap layar.
class NoticePanel extends StatelessWidget {
  const NoticePanel({
    super.key,
    required this.text,
    this.tone = NoticeTone.info,
    this.icon,
    this.bordered = true,
  });

  final String text;
  final NoticeTone tone;
  final IconData? icon;

  /// Beberapa panel (mis. pratinjau stok) tampil lebih tenang tanpa garis tepi.
  final bool bordered;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tone.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: bordered ? Border.all(color: tone.borderColor) : null,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 20, color: tone.ink),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontFamily: AppFonts.body,
                fontSize: 13,
                height: 18 / 13,
                fontWeight: FontWeight.w500,
                color: tone.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
