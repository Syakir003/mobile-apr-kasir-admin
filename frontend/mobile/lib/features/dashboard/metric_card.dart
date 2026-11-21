import 'package:flutter/material.dart';

import '../../core/theme/app_motion.dart';
import '../../core/theme/app_theme.dart';

/// Kartu metrik dashboard. Datar: border 1px, tanpa bayangan/gradient/ornamen. Hanya satu kartu per baris yang
/// [featured] (isi teal solid) untuk metrik utama. Nilai selalu muat (diskalakan turun, tidak pernah dipotong "…"),
/// dan penanda "perlu aksi" berupa titik di pojok, bukan badge yang berebut tempat dengan judul di kartu sempit.
class MetricCard extends StatelessWidget {
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

  /// Metrik utama (mis. penjualan hari ini): isi teal solid, teks putih.
  final bool featured;

  /// Nilai berupa uang: sedikit lebih kecil dari angka biasa karena lebih panjang.
  final bool mono;

  /// Non-null = kartu menuntut tindakan: ditandai titik oranye (badge aslinya tidak dirender di kartu sempit).
  final Widget? badge;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final fg = featured ? Colors.white : AppColors.textInk;
    final muted = featured ? AppColors.tealPale : AppColors.textBody;

    final card = Container(
      constraints: const BoxConstraints(minHeight: 104),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: featured ? AppColors.tealDeep : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: featured ? null : Border.all(color: AppColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: AppFonts.body,
                    fontSize: 13,
                    height: 18 / 13,
                    fontWeight: FontWeight.w500,
                    color: muted,
                  ),
                ),
              ),
              if (badge != null)
                Padding(
                  padding: const EdgeInsets.only(left: 8, top: 4),
                  child: Container(
                    key: const Key('metric-alert-dot'),
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: AppColors.alertBadgeInk,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Diskalakan turun, bukan dipotong: nilai uang jangan pernah jadi "Rp 24.500…".
              SizedBox(
                width: double.infinity,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: AppSwap(
                    switchKey: value,
                    child: Text(
                      value,
                      maxLines: 1,
                      style: TextStyle(
                        fontFamily: AppFonts.display,
                        fontSize: mono ? 24 : 28,
                        height: 1.2,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.4,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        color: fg,
                      ),
                    ),
                  ),
                ),
              ),
              if (sub != null) ...[
                const SizedBox(height: 2),
                Text(
                  sub!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: AppFonts.body,
                    fontSize: 12,
                    height: 16 / 12,
                    color: featured ? AppColors.tealPale : AppColors.textMuted,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );

    if (onTap == null) return card;
    return AppPressable(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.lg),
      splash: !featured,
      child: card,
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
