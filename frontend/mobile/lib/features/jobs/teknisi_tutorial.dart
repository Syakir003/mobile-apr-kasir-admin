import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// Panduan alur kerja teknisi (lembar bergulir). Dibuka dari tombol Tutorial di dashboard
/// dan ikon `?` di detail job.
Future<void> showTeknisiTutorial(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (_) => const _TutorialSheet(),
  );
}

const _steps = <(String, String)>[
  ('Terima job',
      'Job ada di dashboard dan menu Job Saya. Buka job untuk melihat pelanggan, alamat (Buka di Maps), dan Note Pekerjaan dari kasir/admin.'),
  ('Catat temuan',
      'Tekan Tambah Temuan, ketik kategori masalahnya (pisahkan dengan koma untuk banyak temuan). Deskripsi bisa ditambah lewat "Tambah deskripsi".'),
  ('Foto SEBELUM',
      'Unggah minimal satu foto sebelum pada temuan. Tanpa foto ini, pekerjaan belum bisa dimulai.'),
  ('Mulai pekerjaan',
      'Tekan Mulai Pekerjaan lalu scan barcode di unit AC. Kalau unitnya "QR dulu" (data belum lengkap), lengkapi merk dan PK dulu lewat Scan Unit.'),
  ('Kerjakan dan foto SESUDAH',
      'Setelah selesai, unggah foto sesudah pada setiap temuan. Simpan catatan pengerjaan bila perlu.'),
  ('Butuh sparepart?',
      'Pakai Pengajuan Tambahan. Tunggu keputusan kasir/admin, lalu tandai terpakai setelah dipasang.'),
  ('Kirim Temuan (opsional)',
      'Memberi tahu kasir/admin supaya menetapkan harga jasa. Harga tidak menahan kamu mengajukan selesai.'),
  ('Ajukan Selesai',
      'Aktif bila semua temuan punya foto sebelum dan sesudah, dan tidak ada pengajuan sparepart yang menggantung. Admin lalu mereview; kalau dikembalikan, perbaiki dan ajukan lagi.'),
  ('Laporan Pekerjaan',
      'Ikon printer di pojok atas detail job: cetak atau simpan sebagai PDF (berlaku sebagai kartu garansi).'),
];

const _multiUnit = <String>[
  'Satu order bisa berisi beberapa AC. Semuanya tampil di satu halaman, satu bagian per unit.',
  'Scan barcode setiap unit untuk memulainya. Urutannya bebas.',
  'Catat temuan dan foto di bagian masing-masing unit.',
  'Ajukan Selesai sekali untuk semua unit, dan aktif setelah semua unit lengkap.',
  'Pengajuan sparepart hanya satu untuk seluruh order, tidak per AC.',
];

const _handover =
    'Kalau job dialihkan ke teknisi lain, temuan dan foto sebelumnya tetap ada. Teknisi baru wajib scan ulang barcode unit sebelum melanjutkan.';

class _TutorialSheet extends StatelessWidget {
  const _TutorialSheet();

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        children: [
          const Text('Tutorial Teknisi',
              style: TextStyle(
                  fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.slate900)),
          const SizedBox(height: 4),
          const Text('Alur kerja satu job, dari menerima sampai selesai.',
              style: TextStyle(color: AppColors.slate500)),
          const SizedBox(height: 16),
          for (var i = 0; i < _steps.length; i++)
            _StepRow(number: i + 1, title: _steps[i].$1, body: _steps[i].$2),
          const SizedBox(height: 8),
          const _Section(title: 'Servis banyak AC dalam satu order'),
          for (final line in _multiUnit) _Bullet(text: line),
          const SizedBox(height: 12),
          const _Section(title: 'Job dialihkan'),
          const _Bullet(text: _handover),
          const SizedBox(height: 16),
          SizedBox(
            height: 48,
            child: FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Mengerti'),
            ),
          ),
        ],
      ),
    );
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({required this.number, required this.title, required this.body});
  final int number;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 13,
            backgroundColor: AppColors.teal50,
            child: Text('$number',
                style: const TextStyle(
                    fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.teal700)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, color: AppColors.slate900)),
                const SizedBox(height: 2),
                Text(body, style: const TextStyle(color: AppColors.slate600, fontSize: 13.5)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(title,
            style: const TextStyle(
                fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.slate900)),
      );
}

class _Bullet extends StatelessWidget {
  const _Bullet({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('•  ', style: TextStyle(color: AppColors.slate500)),
            Expanded(
              child: Text(text,
                  style: const TextStyle(color: AppColors.slate600, fontSize: 13.5)),
            ),
          ],
        ),
      );
}
