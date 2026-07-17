import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/app_user.dart';
import '../../data/models/technician_job.dart';
import '../notifications/notification_bell.dart';
import 'job_providers.dart';

/// Warna chip status job (dipakai layar daftar & detail).
Color jobStatusColor(JobStatus status) => switch (status) {
      JobStatus.menungguPenugasan => AppColors.slate500,
      JobStatus.assigned => AppColors.blue600,
      JobStatus.sedangDikerjakan => AppColors.warning,
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
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                _FilterChip(
                  label: 'Aktif',
                  selected: !_showDone,
                  onTap: () => setState(() => _showDone = false),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Selesai',
                  selected: _showDone,
                  onTap: () => setState(() => _showDone = true),
                ),
              ],
            ),
          ),
          Expanded(
            child: jobsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('Gagal memuat job: $e',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.slate500)),
                ),
              ),
              data: (all) {
                final jobs = all
                    .where((j) => _showDone ? !j.status.isActive : j.status.isActive)
                    .toList();
                if (jobs.isEmpty) {
                  return _EmptyState(showDone: _showDone);
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: jobs.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) =>
                      _JobCard(job: jobs[i], showTechnician: !isTeknisi),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _JobCard extends StatelessWidget {
  const _JobCard({required this.job, required this.showTechnician});

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
                    const SizedBox(height: 3),
                    Text(
                      '${job.typeLabel} • ${job.memberName.isEmpty ? '-' : job.memberName}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 12.5, color: AppColors.slate500),
                    ),
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
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  job.status.label,
                  style: TextStyle(
                    color: color,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.teal600 : Colors.white,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
                color: selected ? AppColors.teal600 : AppColors.slate200),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : AppColors.slate600,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
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
