import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/ac_unit.dart';
import '../../data/models/technician_job.dart';
import '../jobs/job_list_screen.dart' show jobStatusColor;
import '../jobs/job_providers.dart';
import 'member_providers.dart';

/// Riwayat service satu unit AC — pemasangan, cuci, service, dan maintenance
/// dicatat **per unit**, bukan hanya per pelanggan (dok. fitur §8.1).
///
/// Dibuka dari detail member, detail job, atau hasil scan barcode; karena itu
/// unit bisa datang lewat [initial] (navigasi) atau dimuat sendiri by id.
/// Semua peran boleh melihat: teknisi perlu tahu apa yang pernah dikerjakan
/// pada unit sebelum mulai bekerja.
class UnitHistoryScreen extends ConsumerWidget {
  const UnitHistoryScreen({super.key, required this.unitId, this.initial});

  final String unitId;

  /// Unit dari navigasi (extra); fallback selagi provider belum terisi.
  final AcUnit? initial;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unit = ref.watch(acUnitProvider(unitId)).value ?? initial;
    final jobsAsync = ref.watch(unitJobHistoryProvider(unitId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Riwayat Service'),
        actions: [
          IconButton(
            key: const Key('refresh-history'),
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () {
              ref.invalidate(unitJobHistoryProvider(unitId));
              ref.invalidate(acUnitProvider(unitId));
            },
          ),
        ],
      ),
      body: jobsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'Gagal memuat riwayat: $e',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.slate500),
            ),
          ),
        ),
        data: (jobs) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(unitJobHistoryProvider(unitId));
            ref.invalidate(acUnitProvider(unitId));
          },
          child: ListView(
            key: const Key('unit-history-list'),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            children: [
              _UnitCard(unit: unit, jobs: jobs),
              const SizedBox(height: 18),
              const _SectionLabel('RIWAYAT PEKERJAAN'),
              if (jobs.isEmpty)
                const _EmptyHistory()
              else
                for (var i = 0; i < jobs.length; i++)
                  _HistoryTile(
                    job: jobs[i],
                    isFirst: i == 0,
                    isLast: i == jobs.length - 1,
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Ringkasan unit: identitas, barcode, status, dan jadwal servis.
class _UnitCard extends StatelessWidget {
  const _UnitCard({required this.unit, required this.jobs});

  final AcUnit? unit;
  final List<TechnicianJob> jobs;

  @override
  Widget build(BuildContext context) {
    final u = unit;
    final done = jobs.where((j) => j.status == JobStatus.selesai).toList();
    // `last_service_date` dipelihara backend saat job selesai; bila kosong
    // (mis. data lama) turunkan dari job selesai terbaru.
    final lastService = u?.lastServiceDate ??
        (done.isEmpty ? null : done.first.completedAt);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.teal50,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: const Icon(Icons.ac_unit, color: AppColors.teal700),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        u == null ? 'Unit AC' : '${u.brand} ${u.model}'.trim(),
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                          color: AppColors.slate900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        u == null
                            ? '-'
                            : '${u.pk} PK • '
                                '${u.roomLocation.isEmpty ? '-' : u.roomLocation}',
                        style: const TextStyle(
                            fontSize: 12.5, color: AppColors.slate500),
                      ),
                    ],
                  ),
                ),
                if (u != null)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.teal50,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      u.status.label,
                      style: const TextStyle(
                        color: AppColors.teal700,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            _row(Icons.qr_code, 'Barcode',
                (u?.barcodeValue.isEmpty ?? true)
                    ? 'Belum digenerate'
                    : u!.barcodeValue),
            _row(Icons.build_circle_outlined, 'Total pekerjaan',
                '${jobs.length} • ${done.length} selesai'),
            if (u?.installationDate != null)
              _row(Icons.event_available_outlined, 'Dipasang',
                  formatHistoryDate(u!.installationDate!)),
            _row(Icons.history, 'Servis terakhir',
                lastService == null ? '-' : formatHistoryDate(lastService)),
            if (u?.nextServiceDate != null)
              _row(
                Icons.event_repeat_outlined,
                'Servis berikutnya',
                formatHistoryDate(u!.nextServiceDate!),
                overdue: u.nextServiceDate!.isBefore(DateTime.now()),
              ),
          ],
        ),
      ),
    );
  }

  Widget _row(IconData icon, String label, String value,
      {bool overdue = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon,
              size: 18,
              color: overdue ? AppColors.warning : AppColors.slate400),
          const SizedBox(width: 12),
          Text(label,
              style: const TextStyle(color: AppColors.slate500, fontSize: 13)),
          const Spacer(),
          Flexible(
            child: Text(
              overdue ? '$value (terlewat)' : value,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: overdue ? AppColors.warning : AppColors.slate900,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Satu entri riwayat + rel timeline di kiri. Ketuk untuk membuka detail job
/// (foto bukti sebelum/sesudah & pengajuan material ada di sana).
class _HistoryTile extends StatelessWidget {
  const _HistoryTile({
    required this.job,
    required this.isFirst,
    required this.isLast,
  });

  final TechnicianJob job;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final color = jobStatusColor(job.status);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 24,
            child: Column(
              children: [
                Container(
                  width: 2,
                  height: 10,
                  color: isFirst ? Colors.transparent : AppColors.slate200,
                ),
                Container(
                  width: 11,
                  height: 11,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
                Expanded(
                  child: Container(
                    width: 2,
                    color: isLast ? Colors.transparent : AppColors.slate200,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: InkWell(
                key: Key('history-${job.id}'),
                borderRadius: BorderRadius.circular(AppRadius.md),
                onTap: () => context.go('/jobs/${job.id}'),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              job.typeLabel,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 15,
                                color: AppColors.slate900,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 4),
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
                      const SizedBox(height: 6),
                      Text(
                        historyTimeline(job),
                        style: const TextStyle(
                            fontSize: 12.5, color: AppColors.slate600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        job.technicianName.isEmpty
                            ? 'Teknisi: belum ditugaskan'
                            : 'Teknisi: ${job.technicianName}',
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.slate400),
                      ),
                      if ((job.notes ?? '').trim().isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppColors.slate50,
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                          ),
                          child: Text(
                            job.notes!.trim(),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 12.5, color: AppColors.slate700),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 10),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: AppColors.slate400,
        ),
      ),
    );
  }
}

class _EmptyHistory extends StatelessWidget {
  const _EmptyHistory();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 32),
      child: Column(
        children: [
          Icon(Icons.history_toggle_off, size: 44, color: AppColors.slate300),
          SizedBox(height: 12),
          Text(
            'Belum ada riwayat pekerjaan untuk unit ini.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.slate500),
          ),
        ],
      ),
    );
  }
}

/// Baris waktu satu entri: pakai stempel paling informatif yang tersedia
/// (selesai → mulai → jadwal → dibuat).
String historyTimeline(TechnicianJob job) {
  if (job.completedAt != null) {
    return 'Selesai ${formatHistoryDate(job.completedAt!)}';
  }
  if (job.startedAt != null) {
    return 'Mulai ${formatHistoryDate(job.startedAt!)}';
  }
  if (job.scheduledDate != null) {
    return 'Dijadwalkan ${formatHistoryDate(job.scheduledDate!)}';
  }
  if (job.createdAt != null) {
    return 'Dibuat ${formatHistoryDate(job.createdAt!)}';
  }
  return 'Waktu belum tercatat';
}

String formatHistoryDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
}
