import 'package:flutter/material.dart';

import '../../core/theme/app_motion.dart';
import '../../core/theme/app_theme.dart';

/// Kartu metrik dashboard (frame `Metric Cards Grid`, 10:46).
///
/// Kartu pertama pada baris tampil sebagai varian [featured]: gradient teal
/// dengan nilai memakai JetBrains Mono, sisanya putih dengan nilai Plus Jakarta
/// Sans Bold 32/40. Kedua varian tingginya minimal 140px dan radius 20px.
class MetricCard extends StatefulWidget {
  const MetricCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.sub,
    this.featured = false,
    this.mono = false,
    this.badge,
    this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final String? sub;

  /// Varian gradient — dipakai untuk metrik utama (mis. penjualan hari ini).
  final bool featured;

  /// Nilai berupa uang → JetBrains Mono Bold 20/28, bukan angka besar 32/40.
  final bool mono;

  /// Badge kecil di kanan atas menggantikan ikon (mis. "PERLU AKSI").
  final Widget? badge;

  final VoidCallback? onTap;

  @override
  State<MetricCard> createState() => _MetricCardState();
}

class _MetricCardState extends State<MetricCard> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final featured = widget.featured;
    final labelColor = featured ? AppColors.tealPale : AppColors.textBody;
    final subColor = featured ? AppColors.metricAccent : AppColors.textBody;

    final valueStyle = widget.mono
        ? AppTextStyles.monoAmount.copyWith(
            color: featured ? Colors.white : AppColors.textInk,
            letterSpacing: -0.5,
          )
        : TextStyle(
            fontFamily: AppFonts.display,
            fontSize: 32,
            height: 40 / 32,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.64,
            color: featured ? Colors.white : AppColors.textInk,
          );

    final card = AnimatedContainer(
      duration: AppDurations.base,
      curve: AppCurves.standard,
      constraints: const BoxConstraints(minHeight: 140),
      clipBehavior: featured ? Clip.antiAlias : Clip.none,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: featured ? null : Colors.white,
        gradient: featured ? AppGradients.metricFeatured : null,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: featured
            ? null
            : Border.all(
                color: _hovered ? AppColors.hairline : AppColors.cardHairline,
              ),
        boxShadow: featured
            ? AppShadows.metricFeatured
            : (_hovered ? AppShadows.metricHover : AppShadows.metric),
      ),
      // Ornamen lengkung di pojok kanan atas kartu gradient (10:48) —
      // dua cincin tipis yang sebagian terpotong tepi kartu.
      foregroundDecoration: featured
          ? const _ArcOrnamentDecoration()
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Tinggi baris label dikunci pada dua baris teks (2 × 20px). Tanpa
          // itu, kartu berlabel satu baris ("Belum Lunas") menaruh angkanya
          // 20px lebih tinggi daripada tetangganya, dan deretan kartu terlihat
          // seperti tumpukan kotak yang tidak sejajar.
          SizedBox(
            height: 40,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    widget.label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: AppFonts.display,
                      fontSize: 15,
                      height: 20 / 15,
                      fontWeight: FontWeight.w500,
                      color: labelColor,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                widget.badge ?? _Glyph(icon: widget.icon, featured: featured),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Nilai metrik berubah sendiri lewat Supabase Realtime. Cross-fade
              // membuat perubahan itu terbaca sebagai pembaruan, bukan sebagai
              // angka yang tiba-tiba berbeda.
              AppSwap(
                switchKey: widget.value,
                child: Text(
                  widget.value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: valueStyle,
                ),
              ),
              if (widget.sub != null) ...[
                const SizedBox(height: 4),
                Text(
                  widget.sub!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: AppFonts.body,
                    fontSize: 12,
                    height: 16 / 12,
                    color: subColor,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );

    if (widget.onTap == null) return card;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AppPressable(
        onTap: widget.onTap,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        // Riak putih di atas gradient teal terlihat seperti noda; kartu
        // unggulan cukup mengandalkan skala.
        splash: !featured,
        child: card,
      ),
    );
  }
}

/// Ikon metrik. Pada kartu putih ikon duduk di dalam kepingan Mist supaya
/// tidak jadi satu-satunya bentuk tajam di kartu yang selebihnya lembut.
class _Glyph extends StatelessWidget {
  const _Glyph({required this.icon, required this.featured});

  final IconData icon;
  final bool featured;

  @override
  Widget build(BuildContext context) {
    if (featured) {
      return Icon(
        icon,
        size: 28,
        color: Colors.white.withValues(alpha: 0.85),
      );
    }
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: AppColors.mist,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      alignment: Alignment.center,
      child: Icon(icon, size: 20, color: AppColors.tealDeep),
    );
  }
}

/// Ornamen dua cincin tipis di pojok kanan atas kartu gradient.
///
/// Dipasang sebagai `foregroundDecoration` supaya ikut terpotong oleh radius
/// kartu tanpa perlu `Stack` + `ClipRRect` tambahan.
class _ArcOrnamentDecoration extends Decoration {
  const _ArcOrnamentDecoration();

  @override
  BoxPainter createBoxPainter([VoidCallback? onChanged]) =>
      _ArcOrnamentPainter();
}

class _ArcOrnamentPainter extends BoxPainter {
  @override
  void paint(Canvas canvas, Offset offset, ImageConfiguration cfg) {
    final size = cfg.size;
    if (size == null) return;

    // Pusat cincin berada di luar tepi kanan atas, jadi yang terlihat cuma
    // potongan lengkungnya.
    final center = offset + Offset(size.width + 12, -18);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..color = Colors.white.withValues(alpha: 0.14)
      ..strokeWidth = 14;

    canvas.drawCircle(center, 52, paint);
    canvas.drawCircle(
      center,
      82,
      paint..color = Colors.white.withValues(alpha: 0.08),
    );
  }
}

/// Badge "PERLU AKSI" pada kartu metrik yang menuntut tindakan admin.
class MetricAlertBadge extends StatelessWidget {
  const MetricAlertBadge({super.key, this.label = 'PERLU AKSI'});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.alertBadgeSurface,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.error_outline,
            size: 12,
            color: AppColors.alertBadgeInk,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 12,
              height: 16 / 12,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.3,
              color: AppColors.alertBadgeInk,
            ),
          ),
        ],
      ),
    );
  }
}
