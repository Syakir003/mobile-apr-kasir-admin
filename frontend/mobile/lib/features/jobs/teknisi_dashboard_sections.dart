import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/notice_panel.dart';
import '../../data/models/technician_job.dart';
import 'job_list_screen.dart' show JobCard;
import 'job_providers.dart';

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// Bagian dashboard teknisi di bawah kartu metrik, mengikuti dashboard web:
/// "Perlu Perhatian" (job Ditugaskan tanpa foto sebelum), "Jadwal Hari Ini",
/// dan "Job Aktif Lainnya" (maks 5).
class TeknisiDashboardSections extends ConsumerWidget {
  const TeknisiDashboardSections({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final queue = ref.watch(jobQueueProvider);
    final jobs = [...(queue.value ?? const <TechnicianJob>[])]
      ..sort((a, b) {
        if (a.scheduledDate == null) return 1;
        if (b.scheduledDate == null) return -1;
        return a.scheduledDate!.compareTo(b.scheduledDate!);
      });
    final now = DateTime.now();
    final today = jobs
        .where((j) => j.scheduledDate != null && _sameDay(j.scheduledDate!, now))
        .toList();
    final todayIds = {for (final j in today) j.id};
    final others = jobs.where((j) => !todayIds.contains(j.id)).toList();
    final needsAttention = jobs
        .where((j) => j.status == JobStatus.assigned && j.hasBeforePhoto == false)
        .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (needsAttention.isNotEmpty) ...[
          NoticePanel(
            tone: NoticeTone.warning,
            icon: Icons.warning_amber_rounded,
            text:
                '${needsAttention.length} job belum bisa dimulai - foto Sebelum belum diunggah',
          ),
          for (final j in needsAttention)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => context.go('/jobs/${j.id}'),
                child: Text(
                  '${j.unitTitle.isEmpty ? 'Order ${j.typeLabel}' : j.unitTitle} →',
                ),
              ),
            ),
          const SizedBox(height: AppSpacing.section),
        ],
        AppSectionCard(
          title: 'Jadwal Hari Ini',
          child: queue.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: LinearProgressIndicator(),
            ),
            error: (_, __) => const Text('Gagal memuat job. Tarik untuk memuat ulang.',
                style: TextStyle(color: AppColors.danger)),
            data: (_) => today.isEmpty
                ? const Text('Tidak ada job berjadwal hari ini.',
                    style: TextStyle(color: AppColors.slate500))
                : Column(children: [
                    for (final j in today) ...[
                      JobCard(job: j),
                      const SizedBox(height: 8),
                    ],
                  ]),
          ),
        ),
        if (others.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.section),
          AppSectionCard(
            title: 'Job Aktif Lainnya',
            child: Column(children: [
              for (final j in others.take(5)) ...[
                JobCard(job: j),
                const SizedBox(height: 8),
              ],
              if (others.length > 5)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: () => context.go('/jobs'),
                    child: Text('Lihat semua (${others.length}) →'),
                  ),
                ),
            ]),
          ),
        ],
      ],
    );
  }
}
