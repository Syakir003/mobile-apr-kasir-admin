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
                final rows = groupJobsByOrder(jobs);
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: rows.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) => JobCard(
                      job: rows[i].first, group: rows[i], showTechnician: !isTeknisi),
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
  const JobCard({super.key, required this.job, this.showTechnician = false, this.group = const []});

  final TechnicianJob job;
  final bool showTechnician;

  /// Semua job satu order (servis banyak AC); lebih dari satu = kartu ringkasan order.
  final List<TechnicianJob> group;

  @override
  Widget build(BuildContext context) {
    final many = group.length > 1;
    // Satu baris = satu order banyak AC: status = tahap paling awal di antara unitnya.
    final status = many
        ? group.map((j) => j.status).reduce((a, b) => a.index <= b.index ? a : b)
        : job.status;
    final color = jobStatusColor(status);
    final title = many
        ? '${group.length} unit AC'
        : job.unitTitle.isEmpty
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
                    if (!many && job.unitParts.isNotEmpty) ...[
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
              // Boleh memendek di layar sempit / huruf besar, bukan meluap.
              Flexible(
                child: StatusBadge(label: status.label, color: color, constrained: true),
              ),
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
