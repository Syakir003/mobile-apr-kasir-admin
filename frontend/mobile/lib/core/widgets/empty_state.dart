import 'package:flutter/material.dart';

import '../theme/app_motion.dart';
import '../theme/app_theme.dart';
import '../utils/error_message.dart';

/// Tampilan daftar kosong.
///
/// Sebelumnya pola ini ditulis ulang di tiap layar sebagai ikon abu-abu 48px
/// plus satu kalimat rata tengah — benar secara informasi, tapi terasa seperti
/// halaman galat. Di sini ikonnya duduk di dalam lingkaran Mist (permukaan
/// merek, bukan abu netral), ada judul dan kalimat penjelas terpisah, dan
/// tombol aksi opsional supaya layar kosong menawarkan langkah berikutnya
/// alih-alih sekadar melaporkan ketiadaan data.
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.action,
    this.compact = false,
  });

  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  /// Versi rapat untuk di dalam kartu/tabel yang tingginya terbatas.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final circle = compact ? 56.0 : 76.0;

    return AppRevealIn(
      child: Center(
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: 24,
            vertical: compact ? 28 : 40,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: circle,
                height: circle,
                decoration: const BoxDecoration(
                  color: AppColors.mist,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Icon(
                  icon,
                  size: compact ? 24 : 32,
                  color: AppColors.tealDeep,
                ),
              ),
              SizedBox(height: compact ? 14 : 18),
              Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              if (message != null) ...[
                const SizedBox(height: 6),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 320),
                  child: Text(
                    message!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: AppFonts.body,
                      fontSize: 13,
                      height: 18 / 13,
                      color: AppColors.textMuted,
                    ),
                  ),
                ),
              ],
              if (action != null) ...[
                SizedBox(height: compact ? 16 : 22),
                action!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Tampilan gagal memuat.
///
/// Menggantikan pola `Center(child: Text('Gagal memuat: …'))` yang tersebar di
/// belasan layar. Bedanya dengan [AppEmptyState] bukan cuma warna: daftar
/// kosong itu keadaan yang sah, sedangkan ini kondisi yang bisa dicoba ulang —
/// jadi nadanya coral dan tombol "Coba lagi" ada bila pemanggil bisa memuat
/// ulang datanya.
class AppErrorState extends StatelessWidget {
  const AppErrorState({
    super.key,
    required this.error,
    this.title = 'Gagal memuat data',
    this.onRetry,
    this.compact = false,
  });

  final Object error;
  final String title;
  final VoidCallback? onRetry;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final circle = compact ? 56.0 : 76.0;

    return AppRevealIn(
      child: Center(
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: 24,
            vertical: compact ? 28 : 40,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: circle,
                height: circle,
                decoration: const BoxDecoration(
                  color: AppColors.dangerSurface,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Icon(
                  Icons.cloud_off_outlined,
                  size: compact ? 24 : 30,
                  color: AppColors.coral,
                ),
              ),
              SizedBox(height: compact ? 14 : 18),
              Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 340),
                child: Text(
                  errorMessage(error),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: AppFonts.body,
                    fontSize: 13,
                    height: 18 / 13,
                    color: AppColors.textMuted,
                  ),
                ),
              ),
              if (onRetry != null) ...[
                SizedBox(height: compact ? 16 : 22),
                OutlinedButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Coba lagi'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
