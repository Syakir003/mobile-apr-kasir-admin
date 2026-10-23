import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/utils/tanggal.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/app_user.dart';
import '../../data/models/technician_job.dart';
import '../notifications/notification_bell.dart';
import 'job_providers.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';

/// Warna chip status job (dipakai layar daftar & detail).
Color jobStatusColor(JobStatus status) => switch (status) {
      JobStatus.menungguPenugasan => AppColors.slate500,
      JobStatus.assigned => AppColors.blue600,
      JobStatus.sedangDikerjakan => AppColors.warning,
      JobStatus.menungguReview => AppColors.blue600,
      JobStatus.selesai => AppColors.success,
      JobStatus.dibatalkan => AppColors.textSecondary,
    };

/// Daftar job teknisi. Teknisi melihat job miliknya ("Job Saya"), admin/kasir
/// melihat seluruh job. Difilter Aktif vs Selesai.
class JobListScreen extends ConsumerStatefulWidget {
  const JobListScreen({super.key});

  @override
  ConsumerState<JobListScreen> createState() => _JobListScreenState();
}

class _JobListScreenState extends ConsumerState<JobListScreen> {
  bool _showDone = false;

  @override
  Widget build(BuildContext context) {
    final role = ref.watch(currentUserProvider).value?.role;
    final isTeknisi = role == UserRole.teknisi;
    final jobsAsync = ref.watch(jobsForCurrentUserProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(isTeknisi ? 'Job Saya' : 'Job Teknisi'),
        actions: [
          const NotificationBell(),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(jobsForCurrentUserProvider),
          ),
        ],
      ),
      body: Column(
        children: [
          if (!isTeknisi)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                AppFilterChip(
                  label: 'Aktif',
                  selected: !_showDone,
                  onTap: () => setState(() => _showDone = false),
                ),
                const SizedBox(width: 8),
                AppFilterChip(
                  label: 'Selesai',
                  selected: _showDone,
                  onTap: () => setState(() => _showDone = true),
                ),
              ],
            ),
          ),
          Expanded(
            child: jobsAsync.when(
              loading: () => const AppSkeletonList(),
              error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat job'),
              data: (all) {
                // Teknisi: Selesai ada di layar Riwayat sendiri (sama seperti web).
                final jobs = all
                    .where((j) => (!isTeknisi && _showDone) ? !j.status.isActive : j.status.isActive)
                    .toList();
                if (jobs.isEmpty) {
                  return _EmptyState(showDone: _showDone);
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: jobs.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) =>
                      JobCard(job: jobs[i], showTechnician: !isTeknisi),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class JobCard extends StatelessWidget {
  const JobCard({super.key, required this.job, this.showTechnician = false});

  final TechnicianJob job;
  final bool showTechnician;

  @override
  Widget build(BuildContext context) {
    final color = jobStatusColor(job.status);
    final title = job.unitTitle.isEmpty
        ? 'Order ${job.typeLabel}'
        : job.unitTitle;
    return Card(
      child: InkWell(
        onTap: () => context.go('/jobs/${job.id}'),
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.teal50,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: const Icon(Icons.handyman_outlined,
                    color: AppColors.teal700),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                        color: AppColors.slate900,
                      ),
                    ),
                    if (job.unitParts.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        job.unitParts,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11.5, color: AppColors.slate400),
                      ),
                    ],
                    const SizedBox(height: 3),
                    Text(
                      '${job.typeLabel} • ${job.memberName.isEmpty ? '-' : job.memberName}'
                      '${job.scheduledDate == null ? '' : ' • Jadwal ${formatTanggalSingkat(job.scheduledDate!)}'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 12.5, color: AppColors.slate500),
                    ),
                    if (job.createdAt != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        'Masuk ${formatTanggalSingkat(job.createdAt!)}',
                        style: const TextStyle(
                            fontSize: 11.5, color: AppColors.slate400),
                      ),
                    ],
                    if (showTechnician) ...[
                      const SizedBox(height: 2),
                      Text(
                        job.technicianName.isEmpty
                            ? 'Belum ditugaskan'
                            : 'Teknisi: ${job.technicianName}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11.5, color: AppColors.slate400),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 10),
              StatusBadge(label: job.status.label, color: color),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.showDone});
  final bool showDone;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.inbox_outlined, size: 48, color: AppColors.slate300),
          const SizedBox(height: 12),
          Text(
            showDone ? 'Belum ada job selesai.' : 'Belum ada job aktif.',
            style: const TextStyle(color: AppColors.slate500),
          ),
        ],
      ),
    );
  }
}
