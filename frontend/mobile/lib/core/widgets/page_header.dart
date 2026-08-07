import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Header halaman sesuai frame `Page Header` (10:31): judul H1 Plus Jakarta
/// Sans Bold 32/40, sub-judul beriko, dan satu tombol aksi di kanan.
///
/// Di layar sempit tombol aksi turun ke baris berikutnya supaya judul tidak
/// terpotong — desainnya hanya menyediakan versi desktop.
class PageHeader extends StatelessWidget {
  const PageHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.subtitleIcon,
    this.action,
  });

  final String title;
  final String? subtitle;
  final IconData? subtitleIcon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final heading = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(title, style: Theme.of(context).textTheme.displaySmall),
        if (subtitle != null) ...[
          const SizedBox(height: 4),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (subtitleIcon != null) ...[
                Icon(subtitleIcon, size: 15, color: AppColors.textBody),
                const SizedBox(width: 8),
              ],
              Flexible(
                child: Text(
                  subtitle!,
                  style: const TextStyle(
                    fontFamily: AppFonts.body,
                    fontSize: 14,
                    height: 20 / 14,
                    color: AppColors.textBody,
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );

    if (action == null) return heading;

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 520) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [heading, const SizedBox(height: 12), action!],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(child: heading),
            const SizedBox(width: 16),
            action!,
          ],
        );
      },
    );
  }
}

/// Tombol aksi sekunder pada header halaman (mis. "Ekspor Laporan").
///
/// Frame dashboard menggambarnya dengan radius 8, tapi style guide — yang
/// menyebut dirinya "single source of truth for component styles" — memakai
/// pill untuk semua tombol. Pill yang dipakai supaya tidak ada dua bentuk
/// tombol sekunder dalam satu aplikasi.
class PageHeaderAction extends StatelessWidget {
  const PageHeaderAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 16),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        backgroundColor: AppColors.pageActionSurface,
        foregroundColor: AppColors.navAccent,
        side: const BorderSide(color: AppColors.searchBorder),
        padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 11),
        textStyle: const TextStyle(
          fontFamily: AppFonts.display,
          fontSize: 15,
          height: 20 / 15,
          fontWeight: FontWeight.w500,
        ),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(AppRadius.pill)),
        ),
      ),
    );
  }
}
