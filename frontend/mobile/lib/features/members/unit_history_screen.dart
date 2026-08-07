import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/ac_unit.dart';
import '../../data/models/job_history_extra.dart';
import '../../data/models/technician_job.dart';
import '../jobs/job_list_screen.dart' show jobStatusColor;
import '../jobs/job_providers.dart';
import 'member_providers.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';

/// Riwayat service satu unit AC — pemasangan, cuci, service, dan maintenance
/// dicatat **per unit**, bukan hanya per pelanggan (dok. fitur §8.1).
///
/// Dibuka dari detail member, detail job, atau hasil scan barcode; karena itu
/// unit bisa datang lewat [initial] (navigasi) atau dimuat sendiri by id.
/// Semua peran boleh melihat: teknisi perlu tahu apa yang pernah dikerjakan
/// pada unit sebelum mulai bekerja. Sejak migrasi 0020 cakupannya dibatasi ke
/// unit yang memang pernah ia tangani.
class UnitHistoryScreen extends ConsumerStatefulWidget {
  const UnitHistoryScreen({super.key, required this.unitId, this.initial});

  final String unitId;

  /// Unit dari navigasi (extra); fallback selagi provider belum terisi.
  final AcUnit? initial;

  @override
  ConsumerState<UnitHistoryScreen> createState() => _UnitHistoryScreenState();
}

class _UnitHistoryScreenState extends ConsumerState<UnitHistoryScreen> {
  /// null = semua jenis pekerjaan. Berisi nilai `technician_jobs.type`.
  String? _typeFilter;

  /// Sembunyikan job yang dibatalkan — default tampil supaya riwayat jujur.
  bool _hideCancelled = false;

  void _refresh() {
    ref.invalidate(unitHistoryProvider(widget.unitId));
    ref.invalidate(acUnitProvider(widget.unitId));
  }

  @override
  Widget build(BuildContext context) {
    final unit = ref.watch(acUnitProvider(widget.unitId)).value ??
        widget.initial;
    final async = ref.watch(unitHistoryProvider(widget.unitId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Riwayat Service'),
        actions: [
          IconButton(
            key: const Key('refresh-history'),
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: _refresh,
          ),
        ],
      ),
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat riwayat'),
        data: (history) {
          final all = history.jobs;
          final types = <String>{for (final j in all) j.type}.toList()..sort();
          final shown = [
            for (final j in all)
              if ((_typeFilter == null || j.type == _typeFilter) &&
                  !(_hideCancelled && j.status == JobStatus.dibatalkan))
                j,
          ];

          return RefreshIndicator(
            onRefresh: () async => _refresh(),
            child: ListView(
              key: const Key('unit-history-list'),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                _UnitCard(unit: unit, jobs: all),
                const SizedBox(height: 14),
                _StatsRow(jobs: all, extras: history.extras),
                const SizedBox(height: 18),
                _SectionLabel(
                  'RIWAYAT PEKERJAAN',
                  trailing: shown.length == all.length
                      ? '${all.length} entri'
                      : '${shown.length} dari ${all.length}',
                ),
                if (types.length > 1 ||
                    all.any((j) => j.status == JobStatus.dibatalkan))
                  _FilterBar(
                    types: types,
                    selectedType: _typeFilter,
                    hideCancelled: _hideCancelled,
                    hasCancelled:
                        all.any((j) => j.status == JobStatus.dibatalkan),
                    onType: (t) => setState(() => _typeFilter = t),
                    onToggleCancelled: () =>
                        setState(() => _hideCancelled = !_hideCancelled),
                  ),
                if (all.isEmpty)
                  const _EmptyHistory()
                else if (shown.isEmpty)
                  const _EmptyFiltered()
                else
                  for (var i = 0; i < shown.length; i++)
                    _HistoryTile(
                      job: shown[i],
                      extra: history.extras[shown[i].id] ??
                          JobHistoryExtra.empty,
                      isFirst: i == 0,
                      isLast: i == shown.length - 1,
                    ),
              ],
            ),
          );
        },
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
                  StatusBadge(
                    label: u.status.label,
                    color: AppColors.tealDeep,
                    background: AppColors.mist,
                  ),
              ],
            ),
            const SizedBox(height: 14),
            _row(Icons.qr_code, 'Barcode',
                (u?.barcodeValue.isEmpty ?? true)
                    ? 'Belum digenerate'
                    : u!.barcodeValue),
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

/// Empat angka ringkas di atas timeline: total, selesai, foto bukti, material.
class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.jobs, required this.extras});

  final List<TechnicianJob> jobs;
  final Map<String, JobHistoryExtra> extras;

  @override
  Widget build(BuildContext context) {
    final done = jobs.where((j) => j.status == JobStatus.selesai).length;
    var photos = 0;
    var material = 0;
    for (final j in jobs) {
      final e = extras[j.id] ?? JobHistoryExtra.empty;
      photos += e.photoCount;
      material += e.materialTotal;
    }

    return Row(
      key: const Key('history-stats'),
      children: [
        _StatTile(
          icon: Icons.build_circle_outlined,
          label: 'Pekerjaan',
          value: '${jobs.length}',
          color: AppColors.teal700,
        ),
        _StatTile(
          icon: Icons.check_circle_outline,
          label: 'Selesai',
          value: '$done',
          color: AppColors.green600,
        ),
        _StatTile(
          icon: Icons.photo_library_outlined,
          label: 'Foto bukti',
          value: '$photos',
          color: AppColors.blue600,
        ),
        if (material > 0)
          _StatTile(
            icon: Icons.inventory_2_outlined,
            label: 'Material',
            value: formatRupiahShort(material),
            color: AppColors.indigo600,
          ),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 17, color: color),
              const SizedBox(height: 7),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  value,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
              ),
              const SizedBox(height: 1),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 10.5, color: AppColors.slate500),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Baris filter: jenis pekerjaan + saklar sembunyikan yang dibatalkan.
class _FilterBar extends StatelessWidget {
  const _FilterBar({
    required this.types,
    required this.selectedType,
    required this.hideCancelled,
    required this.hasCancelled,
    required this.onType,
    required this.onToggleCancelled,
  });

  final List<String> types;
  final String? selectedType;
  final bool hideCancelled;
  final bool hasCancelled;
  final ValueChanged<String?> onType;
  final VoidCallback onToggleCancelled;

  @override
  Widget build(BuildContext context) {
    return AppFilterChipBar(
      key: const Key('history-filter'),
      padding: const EdgeInsets.only(bottom: 10),
      children: [
        AppFilterChip(
          label: 'Semua',
          selected: selectedType == null,
          onTap: () => onType(null),
        ),
        for (final t in types)
          AppFilterChip(
            label: jobTypeLabel(t),
            selected: selectedType == t,
            onTap: () => onType(t),
          ),
        if (hasCancelled)
          AppFilterChip(
            label: hideCancelled ? 'Batal disembunyikan' : 'Sembunyikan batal',
            selected: hideCancelled,
            onTap: onToggleCancelled,
          ),
      ],
    );
  }
}

/// Satu entri riwayat + rel timeline di kiri. Ketuk untuk membuka detail job
/// (foto bukti sebelum/sesudah & pengajuan material ada di sana).
class _HistoryTile extends StatelessWidget {
  const _HistoryTile({
    required this.job,
    required this.extra,
    required this.isFirst,
    required this.isLast,
  });

  final TechnicianJob job;
  final JobHistoryExtra extra;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final color = jobStatusColor(job.status);
    final steps = historySteps(job);
    final duration = jobDuration(job);

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
                          StatusBadge(
                            label: job.status.label,
                            color: color,
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),

                      // Rentetan stempel waktu: dibuat → dijadwalkan → mulai →
                      // selesai. Hanya yang benar-benar tercatat ditampilkan.
                      for (final s in steps)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(s.icon, size: 14, color: AppColors.slate400),
                              const SizedBox(width: 8),
                              SizedBox(
                                width: 74,
                                child: Text(
                                  s.label,
                                  style: const TextStyle(
                                      fontSize: 12, color: AppColors.slate500),
                                ),
                              ),
                              Expanded(
                                child: Text(
                                  formatHistoryDate(s.at),
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: AppColors.slate700,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      if (steps.isEmpty)
                        const Text(
                          'Waktu belum tercatat',
                          style: TextStyle(
                              fontSize: 12, color: AppColors.slate400),
                        ),

                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          _Pill(
                            icon: Icons.person_outline,
                            text: job.technicianName.isEmpty
                                ? 'Belum ditugaskan'
                                : job.technicianName,
                          ),
                          if (duration != null)
                            _Pill(
                              icon: Icons.timer_outlined,
                              text: formatDuration(duration),
                            ),
                          if (extra.hasPhotos)
                            _Pill(
                              icon: extra.photosComplete
                                  ? Icons.photo_library
                                  : Icons.photo_library_outlined,
                              text: '${extra.photosBefore} sebelum • '
                                  '${extra.photosAfter} sesudah',
                              color: extra.photosComplete
                                  ? AppColors.green600
                                  : AppColors.warning,
                            ),
                          if (extra.materialItems > 0)
                            _Pill(
                              icon: Icons.inventory_2_outlined,
                              text: 'Material '
                                  '${formatRupiah(extra.materialTotal)}',
                              color: AppColors.indigo600,
                            ),
                          if (extra.materialPending > 0)
                            _Pill(
                              icon: Icons.pending_outlined,
                              text: '${extra.materialPending} pengajuan '
                                  'menunggu',
                              color: AppColors.warning,
                            ),
                        ],
                      ),

                      if ((job.notes ?? '').trim().isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppColors.slate50,
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'CATATAN',
                                style: TextStyle(
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0.5,
                                  color: AppColors.slate400,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                job.notes!.trim(),
                                maxLines: 4,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 12.5, color: AppColors.slate700),
                              ),
                            ],
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

/// Keping info kecil di bawah rentetan waktu.
class _Pill extends StatelessWidget {
  const _Pill({required this.icon, required this.text, this.color});

  final IconData icon;
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.slate500;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: c),
          const SizedBox(width: 5),
          Text(
            text,
            style: TextStyle(
                fontSize: 11.5, color: c, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text, {this.trailing});
  final String text;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 10),
      child: Row(
        children: [
          Text(
            text,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
              color: AppColors.slate400,
            ),
          ),
          const Spacer(),
          if (trailing != null)
            Text(
              trailing!,
              style: const TextStyle(fontSize: 11, color: AppColors.slate400),
            ),
        ],
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

class _EmptyFiltered extends StatelessWidget {
  const _EmptyFiltered();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 28),
      child: Text(
        'Tidak ada entri yang cocok dengan filter.',
        textAlign: TextAlign.center,
        style: TextStyle(color: AppColors.slate500),
      ),
    );
  }
}

/// Satu stempel waktu pada rentetan riwayat.
typedef HistoryStep = ({IconData icon, String label, DateTime at});

/// Rentetan waktu satu entri, urut kronologis. Hanya stempel yang benar-benar
/// tercatat yang ikut — job yang belum dimulai tak menampilkan baris "Mulai".
List<HistoryStep> historySteps(TechnicianJob job) {
  return [
    if (job.createdAt != null)
      (icon: Icons.add_circle_outline, label: 'Dibuat', at: job.createdAt!),
    if (job.scheduledDate != null)
      (
        icon: Icons.event_outlined,
        label: 'Dijadwalkan',
        at: job.scheduledDate!
      ),
    if (job.startedAt != null)
      (icon: Icons.play_circle_outline, label: 'Mulai', at: job.startedAt!),
    if (job.completedAt != null)
      (icon: Icons.check_circle_outline, label: 'Selesai', at: job.completedAt!),
  ];
}

/// Lama pengerjaan (mulai → selesai). Null bila salah satu stempel belum ada
/// atau selesainya lebih awal dari mulai (data lama yang tak konsisten).
Duration? jobDuration(TechnicianJob job) {
  final start = job.startedAt;
  final end = job.completedAt;
  if (start == null || end == null) return null;
  final d = end.difference(start);
  return d.isNegative ? null : d;
}

/// Durasi ringkas: "2 hari 3 jam", "45 menit", "kurang dari 1 menit".
String formatDuration(Duration d) {
  if (d.inMinutes < 1) return 'Kurang dari 1 menit';
  if (d.inHours < 1) return '${d.inMinutes} menit';
  if (d.inDays < 1) {
    final m = d.inMinutes % 60;
    return m == 0 ? '${d.inHours} jam' : '${d.inHours} jam $m menit';
  }
  final h = d.inHours % 24;
  return h == 0 ? '${d.inDays} hari' : '${d.inDays} hari $h jam';
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
