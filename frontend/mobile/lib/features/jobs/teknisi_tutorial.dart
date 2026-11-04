import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// Panduan singkat alur kerja teknisi (lembar bawah). Dibuka dari tombol Tutorial di
/// dashboard dan ikon `?` di detail job.
Future<void> showTeknisiTutorial(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (_) => const _TutorialSheet(),
  );
}

const _steps = <(IconData, String, String)>[
  (Icons.assignment_outlined, 'Buka job', 'Dari dashboard atau Job Saya. Cek alamat dan Note Pekerjaan.'),
  (Icons.add_photo_alternate_outlined, 'Catat temuan + foto sebelum',
      'Tambah Temuan, lalu unggah foto sebelum. Wajib sebelum mulai.'),
  (Icons.qr_code_scanner, 'Mulai pekerjaan', 'Scan barcode di unit AC-nya.'),
  (Icons.photo_camera_outlined, 'Foto sesudah', 'Isi foto sesudah di setiap temuan.'),
  (Icons.check_circle_outline, 'Ajukan Selesai', 'Admin yang mereview. Kalau dikembalikan, perbaiki lalu ajukan lagi.'),
];

class _TutorialSheet extends StatelessWidget {
  const _TutorialSheet();

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Alur kerja teknisi',
              style: TextStyle(
                  fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.slate900)),
          const SizedBox(height: 14),
          for (final (icon, title, body) in _steps)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: AppColors.teal50,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: Icon(icon, size: 20, color: AppColors.teal700),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title,
                            style: const TextStyle(
                                fontWeight: FontWeight.w600, color: AppColors.slate900)),
                        Text(body,
                            style: const TextStyle(fontSize: 13, color: AppColors.slate500)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 4),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.slate50,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: const Text(
              'Satu order bisa berisi beberapa AC: scan dan isi temuan per unit, lalu Ajukan Selesai sekali '
              'untuk semuanya. Kalau job dialihkan ke teknisi lain, scan ulang barcode unit sebelum melanjutkan.',
              style: TextStyle(fontSize: 13, color: AppColors.slate600),
            ),
          ),
        ],
      ),
    );
  }
}
