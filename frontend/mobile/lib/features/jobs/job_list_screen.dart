import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/utils/tanggal.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/app_user.dart';
import '../../data/models/job_distance.dart';
import '../../data/models/technician_job.dart';
import '../notifications/notification_bell.dart';
import 'job_list_logic.dart';
import 'job_list_pdf.dart' show unitTypeText;
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

// Batas dari backend: 300 job per permintaan jarak. Server menghitung bertahap, jadi ditanya ulang tiap 2 detik
// (maksimal 45 kali) selama masih ada yang 'pending'.
const _maxDistanceJobs = 300;
const _distancePoll = Duration(seconds: 2);
const _maxDistancePolls = 45;

/// Daftar job teknisi. Teknisi melihat job miliknya ("Job Saya"), admin/kasir
/// melihat seluruh job. Difilter Aktif vs Selesai, dicari, disaring hari, dan bisa diurutkan "Terdekat dari Toko"
/// (sama dengan Antrian Servis di web).
class JobListScreen extends ConsumerStatefulWidget {
  const JobListScreen({super.key});

  @override
  ConsumerState<JobListScreen> createState() => _JobListScreenState();
}

class _JobListScreenState extends ConsumerState<JobListScreen> {
  bool _showDone = false;
  final _search = TextEditingController();
  String _dayFilter = 'all'; // 'all' | 'today' | 'tomorrow' | 'week' | YYYY-MM-DD
  late final String _todayKey = dayKey(DateTime.now());

  // Urutan "Terdekat dari Toko".
  bool _nearest = false;
  final Map<String, JobDistance> _dist = {};
  String _distKey = ''; // id job yang sedang/sudah ditanyakan
  bool _loadingDist = false;
  Object? _distError;
  int _polls = 0;
  Timer? _pollTimer;

  @override
  void dispose() {
    _pollTimer?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _fetchDistances(List<String> ids, {bool resetPolls = false}) async {
    _pollTimer?.cancel();
    final key = ids.join(',');
    setState(() {
      _distKey = key;
      _loadingDist = true;
      _distError = null;
      if (resetPolls) _polls = 0;
    });
    try {
      final r = await ref.read(jobDistancesCallerProvider)(ids);
      if (!mounted || key != _distKey || !_nearest) return;
      setState(() {
        for (final d in r.items) {
          _dist[d.jobId] = d;
        }
        _loadingDist = false;
        _polls++;
      });
      if (r.items.any((i) => i.state == DistanceState.pending) && _polls < _maxDistancePolls) {
        _pollTimer = Timer(_distancePoll, () {
          if (mounted && key == _distKey && _nearest) _fetchDistances(ids);
        });
      }
    } catch (e) {
      if (mounted && key == _distKey) {
        setState(() {
          _loadingDist = false;
          _distError = e;
        });
      }
    }
  }

  void _setNearest(bool v) {
    _pollTimer?.cancel();
    setState(() {
      _nearest = v;
      _distKey = ''; // paksa tanya ulang saat dibuka lagi
      _polls = 0;
      _distError = null;
    });
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _dayFilter.contains('-') ? DateTime.parse(_dayFilter) : now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 2),
    );
    if (d != null) setState(() => _dayFilter = dayKey(d));
  }

  void _openPrintList() {
    final (from, to) = dayFilterRange(_dayFilter, _todayKey);
    final q = _search.text.trim();
    context.push(Uri(path: '/jobs/print-list', queryParameters: {
      'status': _showDone ? 'selesai' : 'aktif',
      if (from.isNotEmpty) 'from': from,
      if (to.isNotEmpty) 'to': to,
      if (q.isNotEmpty) 'q': q,
    }).toString());
  }

  void _resetFilters() => setState(() {
        _search.clear();
        _dayFilter = 'all';
      });

  @override
  Widget build(BuildContext context) {
    final role = ref.watch(currentUserProvider).value?.role;
    final isTeknisi = role == UserRole.teknisi;
    final isAdmin = role == UserRole.admin;
    final jobsAsync = ref.watch(jobsForCurrentUserProvider);
    final pickedDate = _dayFilter.contains('-') ? _dayFilter : '';

    return Scaffold(
      appBar: AppBar(
        title: Text(isTeknisi ? 'Job Saya' : 'Antrian Servis'),
        actions: [
          const NotificationBell(),
          if (!isTeknisi)
            IconButton(
              key: const Key('job-print-list'),
              icon: const Icon(Icons.print_outlined),
              tooltip: 'Cetak daftar pekerjaan',
              onPressed: _openPrintList,
            ),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () {
              _distKey = ''; // jarak ikut dihitung ulang
              ref.invalidate(jobsForCurrentUserProvider);
            },
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
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: TextField(
              key: const Key('job-search'),
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                isDense: true,
                hintText: 'Cari pelanggan, unit, lokasi, jenis${isAdmin ? ', teknisi' : ''}',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        tooltip: 'Hapus pencarian',
                        onPressed: () => setState(_search.clear),
                      ),
              ),
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: Row(
              children: [
                // Urutan di posisi pertama supaya tidak tersembunyi di ujung kanan layar sempit.
                AppFilterChip(
                  key: const Key('job-sort-nearest'),
                  label: 'Terdekat dari Toko',
                  selected: _nearest,
                  onTap: () => _setNearest(!_nearest),
                ),
                const SizedBox(width: 16),
                AppFilterChip(label: 'Semua Hari', selected: _dayFilter == 'all', onTap: () => setState(() => _dayFilter = 'all')),
                const SizedBox(width: 8),
                AppFilterChip(
                  label: 'Hari Ini (${formatTanggalSingkat(DateTime.parse(_todayKey)).replaceFirst(RegExp(r' \d{4}$'), '')})',
                  selected: _dayFilter == 'today',
                  onTap: () => setState(() => _dayFilter = 'today'),
                ),
                const SizedBox(width: 8),
                AppFilterChip(label: 'Besok', selected: _dayFilter == 'tomorrow', onTap: () => setState(() => _dayFilter = 'tomorrow')),
                const SizedBox(width: 8),
                AppFilterChip(label: 'Minggu Ini', selected: _dayFilter == 'week', onTap: () => setState(() => _dayFilter = 'week')),
                const SizedBox(width: 8),
                AppFilterChip(
                  label: pickedDate.isEmpty ? 'Pilih Tanggal' : formatTanggalSingkat(DateTime.parse(pickedDate)),
                  selected: pickedDate.isNotEmpty,
                  onTap: _pickDate,
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
                final term = _search.text.trim().toLowerCase();
                var rows = groupJobsByOrder(jobs)
                    .where((row) =>
                        (term.isEmpty || rowSearchText(row, includeTechnician: isAdmin).contains(term)) &&
                        row.any((j) => matchesDay(j, _dayFilter, _todayKey)))
                    .toList();

                // Jarak dihitung untuk job pada daftar Aktif/Selesai yang sedang dibuka (bukan hanya yang lolos
                // pencarian), jadi mengetik di kolom cari tidak memicu perhitungan ulang.
                final distIds = [for (final j in jobs.take(_maxDistanceJobs)) j.id];
                if (_nearest && _distKey != distIds.join(',') && !_loadingDist) {
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    if (mounted && _nearest && _distKey != distIds.join(',')) _fetchDistances(distIds, resetPolls: true);
                  });
                }
                final distances = <List<TechnicianJob>, RowDistance>{};
                if (_nearest) {
                  for (final r in rows) {
                    distances[r] = rowDistance(r, _dist);
                  }
                  final order = nearestOrder([for (final r in rows) distances[r]!]);
                  rows = [for (final i in order) rows[i]];
                }

                final header = _nearest ? _distanceSummary(rows, distances, distIds, isTeknisi) : null;
                if (rows.isEmpty) {
                  return _NoMatch(onReset: _resetFilters);
                }
                final filtersActive = term.isNotEmpty || _dayFilter != 'all';
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  itemCount: rows.length + 1 + (header == null ? 0 : 1),
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) {
                    // Jumlah job pada daftar (seperti lencana "Daftar Job" di web) + tombol Reset saat ada filter.
                    if (i == 0) {
                      return SizedBox(
                        height: 36,
                        child: Row(children: [
                          Text('${rows.length} job',
                              key: const Key('job-count'),
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.slate600)),
                          const Spacer(),
                          if (filtersActive)
                            TextButton.icon(
                              key: const Key('job-reset'),
                              onPressed: _resetFilters,
                              icon: const Icon(Icons.close, size: 14),
                              label: const Text('Reset'),
                              style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                            ),
                        ]),
                      );
                    }
                    if (header != null && i == 1) return header;
                    final row = rows[i - 1 - (header == null ? 0 : 1)];
                    final d = distances[row];
                    return JobQueueCard(
                      group: row,
                      showStaff: !isTeknisi,
                      distance: d,
                      distanceLoading: _loadingDist,
                      onFixAddress: isTeknisi
                          ? null
                          : () => context.push(
                              isAdmin && !row.first.hasWorkLocation && row.first.memberId.isNotEmpty
                                  ? '/members/${row.first.memberId}'
                                  : '/jobs/${row.first.id}'),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  /// Keterangan di atas daftar saat urutan "Terdekat": progres hitung, ringkasan yang gagal, dan tombol coba lagi.
  Widget _distanceSummary(
    List<List<TechnicianJob>> rows,
    Map<List<TechnicianJob>, RowDistance> distances,
    List<String> distIds,
    bool isTeknisi,
  ) {
    final items = [for (final id in distIds) if (_dist[id] != null) _dist[id]!];
    final hasPending = items.any((i) => i.state == DistanceState.pending);
    final exhausted = hasPending && _polls >= _maxDistancePolls;
    final calculating = _distError == null && (_loadingDist || (hasPending && !exhausted) || items.isEmpty);
    final done = items.where((i) => i.state != DistanceState.pending).length;

    final counts = <DistanceReason, int>{};
    var wilayah = 0;
    for (final r in rows) {
      final d = distances[r]!;
      if (d.state == DistanceState.unknown) counts[d.reason!] = (counts[d.reason!] ?? 0) + 1;
      if (d.state == DistanceState.ok && d.precision == DistancePrecision.wilayah) wilayah++;
    }
    const labels = {
      DistanceReason.noAddress: 'tanpa alamat',
      DistanceReason.incomplete: 'alamat kurang lengkap (belum ada kabupaten/kota)',
      DistanceReason.notFound: 'alamat tidak ditemukan di peta',
      DistanceReason.serviceError: 'gagal dicari karena layanan peta menolak',
    };
    final unknown = [for (final e in counts.entries) '${e.value} ${labels[e.key]}'].join(', ');

    final lines = <String>[
      if (calculating) 'Menghitung jarak... ($done dari ${distIds.length} job selesai). Urutan terus diperbarui.',
      if (_distError != null) 'Gagal menghitung jarak. Periksa koneksi lalu coba lagi.',
      if (exhausted) 'Sebagian alamat belum selesai dihitung.',
      if (!calculating && unknown.isNotEmpty) 'Jarak tidak diketahui: $unknown. Job ini ditaruh di bawah.',
      if (wilayah > 0) '$wilayah job hanya diketahui sampai kota/kabupaten (jarak ke pusat wilayahnya, bukan lokasi sebenarnya).',
    ];
    if (lines.isEmpty) return const SizedBox.shrink();
    return Container(
      key: const Key('job-distance-summary'),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.teal50,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final l in lines) Text(l, style: const TextStyle(fontSize: 12, height: 1.35, color: AppColors.slate600)),
          if (_distError != null || exhausted)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => _fetchDistances(distIds, resetPolls: true),
                child: const Text('Coba lagi'),
              ),
            ),
        ],
      ),
    );
  }
}

class JobCard extends StatelessWidget {
  const JobCard({
    super.key,
    required this.job,
    this.showTechnician = false,
    this.group = const [],
    this.distance,
    this.distanceLoading = false,
    this.onFixAddress,
  });

  final TechnicianJob job;
  final bool showTechnician;

  /// Semua job satu order (servis banyak AC); lebih dari satu = kartu ringkasan order.
  final List<TechnicianJob> group;

  /// Jarak ke toko (hanya saat urutan "Terdekat" aktif); null = tak ditampilkan.
  final RowDistance? distance;
  final bool distanceLoading;

  /// Tautan "Perbaiki alamat" saat jarak gagal karena alamat (admin/kasir saja).
  final VoidCallback? onFixAddress;

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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.teal50,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: const Icon(Icons.handyman_outlined, color: AppColors.teal700),
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
                            style: const TextStyle(fontSize: 11.5, color: AppColors.slate400),
                          ),
                        ],
                        const SizedBox(height: 3),
                        Text(
                          '${job.typeLabel} • ${job.memberName.isEmpty ? '-' : job.memberName}'
                          '${job.scheduledDate == null ? '' : ' • Jadwal ${formatTanggalSingkat(job.scheduledDate!)}'}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12.5, color: AppColors.slate500),
                        ),
                        if (job.createdAt != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            'Masuk ${formatTanggalSingkat(job.createdAt!)}',
                            style: const TextStyle(fontSize: 11.5, color: AppColors.slate400),
                          ),
                        ],
                        if (showTechnician) ...[
                          const SizedBox(height: 2),
                          Text(
                            job.technicianName.isEmpty ? 'Belum ditugaskan' : 'Teknisi: ${job.technicianName}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 11.5, color: AppColors.slate400),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Boleh memendek di layar sempit / huruf besar, bukan meluap.
                  Flexible(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        StatusBadge(label: status.label, color: color, constrained: true),
                        // Job komplain bertipe perbaikan: lencana supaya tak tertukar dengan Perbaikan biasa.
                        if ((group.isEmpty ? [job] : group).any((j) => j.isComplaint)) ...[
                          const SizedBox(height: 4),
                          const StatusBadge(
                              key: Key('complaint-badge'),
                              label: 'Komplain',
                              color: AppColors.warning,
                              constrained: true),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              if (distance != null) ...[
                const SizedBox(height: 8),
                _DistanceBadge(d: distance!, loading: distanceLoading, onFix: onFixAddress),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Baris Antrian Servis (cerminan baris daftar di queue-client.tsx web): "pelanggan · unit", info AC dan lokasi kerja,
/// catatan, lalu chip jenis, jarak, jadwal, teknisi, dan "Tentukan harga jasa". Satu baris = satu order
/// (servis banyak AC = satu baris untuk seluruh unit).
class JobQueueCard extends StatelessWidget {
  const JobQueueCard({
    super.key,
    required this.group,
    this.showStaff = false,
    this.distance,
    this.distanceLoading = false,
    this.onFixAddress,
  });

  final List<TechnicianJob> group;

  /// Admin & kasir: chip teknisi dan "Tentukan harga jasa" ikut tampil (teknisi tidak melihatnya, sama dengan web).
  final bool showStaff;
  final RowDistance? distance;
  final bool distanceLoading;
  final VoidCallback? onFixAddress;

  @override
  Widget build(BuildContext context) {
    final job = group.first;
    final many = group.length > 1;
    final status = many ? group.map((j) => j.status).reduce((a, b) => a.index <= b.index ? a : b) : job.status;
    final customer = job.memberName.isEmpty ? 'Order servis' : job.memberName;
    final unitName = job.unitTitle.isEmpty ? 'Order ${job.typeLabel}' : job.unitTitle;
    final unitsText = many ? group.map(unitTypeText).join(' • ') : job.unitParts;
    final locations = rowLocations(group);
    final locationText = locations.isEmpty
        ? ''
        : '${locations.first}${locations.length > 1 ? ' (+${locations.length - 1} lokasi lain)' : ''}';
    final note = group.map((j) => (j.notes ?? '').trim()).where((n) => n.isNotEmpty).firstOrNull;
    final scheduled = group.map((j) => j.scheduledDate).whereType<DateTime>().firstOrNull;
    final names = {for (final j in group) ...(j.technicianNames.isNotEmpty ? j.technicianNames : [if (j.technicianName.isNotEmpty) j.technicianName])};
    const muted = TextStyle(fontSize: 12, color: AppColors.slate600);

    return Card(
      child: InkWell(
        onTap: () => context.go('/jobs/${job.id}'),
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    // Pelanggan di baris sendiri, unit di bawahnya: sebelumnya keduanya dijejal satu baris sampai unitnya
                    // terpotong ("Daik…").
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(
                        customer,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 15, height: 1.3, fontWeight: FontWeight.w600, color: AppColors.slate900),
                      ),
                      Text(many ? '${group.length} unit AC' : unitName, style: muted.copyWith(fontSize: 13)),
                    ]),
                  ),
                  const SizedBox(width: 10),
                  Flexible(child: StatusBadge(label: status.label, color: jobStatusColor(status), constrained: true)),
                ],
              ),
              if (unitsText.isNotEmpty) ...[const SizedBox(height: 4), Text(unitsText, style: muted)],
              if (locationText.isNotEmpty) ...[
                const SizedBox(height: 4),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 1),
                    child: Icon(Icons.place_outlined, size: 14, color: AppColors.teal700),
                  ),
                  const SizedBox(width: 4),
                  Expanded(child: Text(locationText, style: muted.copyWith(fontWeight: FontWeight.w500))),
                ]),
              ],
              if (note != null) ...[
                const SizedBox(height: 4),
                Text('Catatan: $note', style: muted.copyWith(fontStyle: FontStyle.italic)),
              ],
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                _QueueChip(job.typeLabel, fg: AppColors.slate600, bg: AppColors.slate100),
                if (distance != null) _DistanceBadge(d: distance!, loading: distanceLoading, onFix: onFixAddress),
                if (group.any((j) => j.isComplaint))
                  const _QueueChip('Komplain', fg: AppColors.warning, bg: Color(0x26F59E0B), key: Key('complaint-badge')),
                if (scheduled != null)
                  _QueueChip('Jadwal ${formatTanggalSingkat(scheduled)}', icon: Icons.event_outlined, fg: AppColors.slate600, bg: AppColors.slate100),
                if (showStaff)
                  _QueueChip(
                    names.isEmpty ? 'Belum ditugaskan' : names.join(', '),
                    icon: Icons.person_outline,
                    fg: names.isEmpty ? AppColors.slate600 : AppColors.teal700,
                    bg: names.isEmpty ? AppColors.slate100 : AppColors.teal50,
                  ),
                if (showStaff && rowNeedsPrice(group))
                  _QueueChip(many ? 'Tentukan harga jasa tiap unit' : 'Tentukan harga jasa',
                      fg: AppColors.warning, bg: const Color(0x26F59E0B)),
              ]),
              if (job.createdAt != null) ...[
                const SizedBox(height: 6),
                Text('Masuk ${formatTanggalSingkat(job.createdAt!)} ${_jam(job.createdAt!)}',
                    style: const TextStyle(fontSize: 11.5, color: AppColors.slate400)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

String _jam(DateTime d) => '${d.hour.toString().padLeft(2, '0')}.${d.minute.toString().padLeft(2, '0')}';

class _QueueChip extends StatelessWidget {
  const _QueueChip(this.text, {super.key, required this.fg, required this.bg, this.icon});

  final String text;
  final Color fg;
  final Color bg;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(AppRadius.sm)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: 13, color: fg), const SizedBox(width: 4)],
          Flexible(child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg))),
        ]),
      );
}

/// Lencana jarak ke toko di kartu job (cerminan `DistanceBadge` di web).
class _DistanceBadge extends StatelessWidget {
  const _DistanceBadge({required this.d, required this.loading, this.onFix});

  final RowDistance d;
  final bool loading;
  final VoidCallback? onFix;

  @override
  Widget build(BuildContext context) {
    Widget pill(String text, {required Color fg, required Color bg}) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(AppRadius.sm)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.navigation_outlined, size: 13, color: fg),
              const SizedBox(width: 4),
              Flexible(child: Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg))),
            ],
          ),
        );

    if (d.state == DistanceState.ok) {
      final wilayah = d.precision == DistancePrecision.wilayah;
      final extra = d.precision != null && d.precision != DistancePrecision.titik ? ' · ${d.precision!.label}' : '';
      return pill(
        '± ${kmText(d.km!)} dari toko$extra',
        fg: wilayah ? AppColors.warning : AppColors.teal700,
        bg: wilayah ? AppColors.warning.withValues(alpha: 0.15) : AppColors.teal50,
      );
    }
    final calculating = d.state == DistanceState.pending || loading;
    final fixable = !calculating && onFix != null && (d.reason == DistanceReason.incomplete || d.reason == DistanceReason.notFound);
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 8,
      children: [
        pill(
          calculating ? 'Menghitung jarak...' : 'Jarak tidak diketahui: ${d.reason!.label.toLowerCase()}',
          fg: AppColors.slate600,
          bg: AppColors.slate100,
        ),
        if (fixable)
          GestureDetector(
            key: const Key('fix-address'),
            onTap: onFix,
            child: const Text(
              'Perbaiki alamat',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.teal700, decoration: TextDecoration.underline),
            ),
          ),
      ],
    );
  }
}

class _NoMatch extends StatelessWidget {
  const _NoMatch({required this.onReset});
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.search_off, size: 48, color: AppColors.slate300),
          const SizedBox(height: 12),
          const Text('Tidak ada job yang cocok dengan filter.', style: TextStyle(color: AppColors.slate500)),
          TextButton(key: const Key('job-reset-filter'), onPressed: onReset, child: const Text('Reset filter')),
        ],
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
