import 'package:flutter/material.dart';

import '../theme/app_motion.dart';
import '../theme/app_theme.dart';

/// Permukaan kartu standar: putih, radius 20px, dan soft teal drop shadow —
/// sesuai bagian "Surface & Elevation" pada style guide.
///
/// Kartu tanpa [onTap] hanya digambar. Kartu yang bisa ditekan mengangkat
/// bayangannya saat kursor melintas dan mengecil sedikit saat ditekan; tanpa
/// itu kartu sebesar ini nyaris tidak memberi tanda bahwa ia bisa diklik,
/// karena riak Material tenggelam di area 260×168.
class AppCard extends StatefulWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding,
    this.onTap,
  });

  final Widget child;

  /// Padding dalam. Bila null dipakai 24px di layar lebar dan 18px di layar
  /// sempit — 24px di ponsel menyisakan terlalu sedikit ruang untuk isinya.
  final EdgeInsetsGeometry? padding;

  final VoidCallback? onTap;

  @override
  State<AppCard> createState() => _AppCardState();
}

class _AppCardState extends State<AppCard> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.xl);
    final padding = widget.padding ??
        EdgeInsets.all(
          MediaQuery.sizeOf(context).width >= AppSpacing.wideBreakpoint
              ? AppSpacing.card
              : 18,
        );

    final decorated = AnimatedContainer(
      duration: AppDurations.base,
      curve: AppCurves.standard,
      padding: padding,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: radius,
        border: Border.all(
          color: _hovered ? AppColors.hairline : AppColors.cardHairline,
        ),
        boxShadow: _hovered ? AppShadows.metricHover : AppShadows.metric,
      ),
      child: widget.child,
    );

    if (widget.onTap == null) return decorated;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AppPressable(
        onTap: widget.onTap,
        borderRadius: radius,
        child: decorated,
      ),
    );
  }
}

/// Kartu dengan judul bagian dan aksi opsional di kanan atas — pola berulang
/// pada frame Dashboard dan layar daftar.
///
/// Desain memisahkan judul dari isi dengan garis penuh selebar kartu. Garis itu
/// dihilangkan di sini dan diganti jarak: dalam satu halaman ada tiga sampai
/// empat kartu semacam ini, dan setiap garis menambah satu batas horizontal
/// tegas sehingga halaman membaca sebagai tumpukan kotak bergaris. Jarak sudah
/// cukup memisahkan judul dari isi. Setel [divider] bila memang dibutuhkan,
/// mis. saat isinya tabel yang barisnya juga bergaris.
class AppSectionCard extends StatelessWidget {
  const AppSectionCard({
    super.key,
    required this.title,
    required this.child,
    this.subtitle,
    this.action,
    this.padding,
    this.divider = false,
  });

  final String title;
  final String? subtitle;
  final Widget child;
  final Widget? action;
  final EdgeInsetsGeometry? padding;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        style: const TextStyle(
                          fontFamily: AppFonts.body,
                          fontSize: 13,
                          height: 18 / 13,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (action != null) ...[
                const SizedBox(width: 12),
                action!,
              ],
            ],
          ),
          if (divider) ...[
            const SizedBox(height: 16),
            const Divider(color: AppColors.mist, height: 1),
            const SizedBox(height: 16),
          ] else
            const SizedBox(height: 18),
          child,
        ],
      ),
    );
  }
}
