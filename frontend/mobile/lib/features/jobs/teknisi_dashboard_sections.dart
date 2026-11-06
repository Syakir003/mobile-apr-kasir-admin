import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_motion.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/app_card.dart';
import '../../data/models/technician_job.dart';
import '../profile/user_avatar.dart';
import 'job_detail_screen.dart' show mapsUriFor, workMapsUriFor;
import 'job_list_screen.dart' show JobCard;
import 'job_providers.dart';
import 'teknisi_tutorial.dart';

// ---------------------------------------------------------------------------
// Logika murni (diuji di test/features/jobs/teknisi_dashboard_test.dart)
// ---------------------------------------------------------------------------

DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);
bool _sameDay(DateTime a, DateTime b) => _day(a) == _day(b);

/// Job yang paling perlu dikerjakan: yang sedang dikerjakan dulu, lalu yang
/// ditugaskan dengan jadwal paling awal (terlambat ikut paling atas); tanpa
/// jadwal paling akhir. Menunggu review bukan pekerjaan teknisi lagi.
TechnicianJob? nextJob(List<TechnicianJob> jobs) {
  final working =
      jobs.where((j) => j.status == JobStatus.sedangDikerjakan).toList();
  if (working.isNotEmpty) return working.first;
  final assigned = jobs.where((j) => j.status == JobStatus.assigned).toList()
    ..sort((a, b) {
      if (a.scheduledDate == null) return b.scheduledDate == null ? 0 : 1;
      if (b.scheduledDate == null) return -1;
      return a.scheduledDate!.compareTo(b.scheduledDate!);
    });
  return assigned.isEmpty ? null : assigned.first;
}

/// Filter daftar dashboard: per hari (null = semua) dan per status (null = semua).
List<TechnicianJob> filterJobs(List<TechnicianJob> jobs,
        {DateTime? day, JobStatus? status}) =>
    [
      for (final j in jobs)
        if ((day == null ||
                (j.scheduledDate != null && _sameDay(j.scheduledDate!, day))) &&
            (status == null || j.status == status))
          j,
    ];

/// Link WhatsApp ke nomor pelanggan. Nomor tersimpan `+62855...`, tapi data
/// lama bisa `0855...`; keduanya jadi `62855...`. Kosong = tanpa tombol WA.
Uri? waUriFor(String phone) {
  var digits = phone.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('0')) digits = '62${digits.substring(1)}';
  return digits.length < 8 ? null : Uri.https('wa.me', '/$digits');
}

/// "Hari ini", "Besok", "Terlambat 2 hari", atau tanggal singkat.
String scheduleLabel(DateTime? scheduled, DateTime now) {
  if (scheduled == null) return 'Belum dijadwalkan';
  final diff = _day(scheduled).difference(_day(now)).inDays;
  if (diff == 0) return 'Hari ini';
  if (diff == 1) return 'Besok';
  if (diff < 0) return 'Terlambat ${-diff} hari';
  return formatTanggalSingkat(scheduled);
}

String _greeting(DateTime now) => switch (now.hour) {
      < 11 => 'Selamat pagi',
      < 15 => 'Selamat siang',
      < 18 => 'Selamat sore',
      _ => 'Selamat malam',
    };

// ---------------------------------------------------------------------------
// Tampilan
// ---------------------------------------------------------------------------

/// Dashboard teknisi: sapaan + ringkasan, "Kerjakan Sekarang" (aksi cepat
/// navigasi/telepon/WA), job yang perlu foto, strip 7 hari, dan daftar job
/// yang bisa difilter per hari & status. Tarik-untuk-refresh ada di
/// [DashboardScreen].
class TeknisiDashboard extends ConsumerStatefulWidget {
  const TeknisiDashboard({super.key});

  @override
  ConsumerState<TeknisiDashboard> createState() => _TeknisiDashboardState();
}

class _TeknisiDashboardState extends ConsumerState<TeknisiDashboard> {
  DateTime? _day;
  JobStatus? _status;

  @override
  Widget build(BuildContext context) {
    final queue = ref.watch(jobQueueProvider);
    final jobs = queue.value ?? const <TechnicianJob>[];
    final now = DateTime.now();
    final next = nextJob(jobs);
    final needsPhoto = jobs
        .where(
            (j) => j.status == JobStatus.assigned && j.hasBeforePhoto == false)
        .toList();
    final filtered = filterJobs(jobs, day: _day, status: _status)
      ..sort((a, b) => (a.scheduledDate ?? DateTime(9999))
          .compareTo(b.scheduledDate ?? DateTime(9999)));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppRevealIn.at(0, child: _Hero(jobs: jobs, now: now)),
        const SizedBox(height: 16),
        if (queue.isLoading && !queue.hasValue)
          const LinearProgressIndicator()
        else if (queue.hasError && !queue.hasValue)
          const AppCard(
            child: Text('Gagal memuat job. Tarik ke bawah untuk memuat ulang.',
                style: TextStyle(color: AppColors.danger)),
          )
        else ...[
          AppRevealIn.at(
            1,
            child: next == null
                ? const _AllClear()
                : _NextJobCard(
                    job: next,
                    units: jobs.where((j) => j.orderId == next.orderId).length,
                    now: now,
                  ),
          ),
          if (needsPhoto.isNotEmpty) ...[
            const SizedBox(height: 16),
            AppRevealIn.at(2, child: _NeedsPhoto(jobs: needsPhoto)),
          ],
          const SizedBox(height: 16),
          AppRevealIn.at(
            3,
            child: _WeekStrip(
              jobs: jobs,
              now: now,
              selected: _day,
              onSelect: (d) => setState(
                  () => _day = (_day != null && _sameDay(_day!, d)) ? null : d),
            ),
          ),
          const SizedBox(height: 12),
          AppRevealIn.at(
            4,
            child: AppSectionCard(
              title: _day == null
                  ? 'Semua Job Aktif'
                  : 'Job ${formatTanggalPanjang(_day!)}',
              action: _day == null
                  ? null
                  : TextButton(
                      onPressed: () => setState(() => _day = null),
                      child: const Text('Semua hari')),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _StatusChips(
                    jobs: filterJobs(jobs, day: _day),
                    selected: _status,
                    onSelect: (s) => setState(() => _status = s),
                  ),
                  const SizedBox(height: 12),
                  AppSwap(
                    switchKey:
                        '${_day?.toIso8601String()}-${_status?.value}-${filtered.length}',
                    child: filtered.isEmpty
                        ? const Padding(
                            padding: EdgeInsets.symmetric(vertical: 16),
                            child: Text('Tidak ada job untuk pilihan ini.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: AppColors.slate500)),
                          )
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              for (final g in groupJobsByOrder(filtered)) ...[
                                JobCard(job: g.first, group: g),
                                const SizedBox(height: 8),
                              ],
                            ],
                          ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _Hero extends ConsumerWidget {
  const _Hero({required this.jobs, required this.now});
  final List<TechnicianJob> jobs;
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).value;
    final done = ref.watch(jobHistoryProvider(1)).value?.total;
    final today = jobs
        .where(
            (j) => j.scheduledDate != null && _sameDay(j.scheduledDate!, now))
        .length;
    final late = jobs
        .where((j) =>
            j.status == JobStatus.assigned &&
            j.scheduledDate != null &&
            _day(j.scheduledDate!).isBefore(_day(now)))
        .length;
    final firstName = (user?.displayName.trim().split(' ').first ?? '');

    return Row(
      children: [
        if (user != null) UserAvatar(user: user, size: 56),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${_greeting(now)}${firstName.isEmpty ? '' : ', $firstName'}',
                key: const Key('teknisi-greeting'),
                style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: AppColors.slate900),
              ),
              const SizedBox(height: 2),
              Text(formatTanggalPanjang(now),
                  style:
                      const TextStyle(color: AppColors.slate500, fontSize: 13)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _Pill(
                      text: today == 0
                          ? 'Tidak ada job hari ini'
                          : '$today job hari ini'),
                  _Pill(text: '${jobs.length} aktif'),
                  if (done != null)
                    _Pill(
                        text: '$done selesai',
                        onTap: () => context.go('/riwayat')),
                  if (late > 0) _Pill(text: '$late terlambat', danger: true),
                ],
              ),
            ],
          ),
        ),
        IconButton(
          tooltip: 'Tutorial',
          icon: const Icon(Icons.help_outline, color: AppColors.slate500),
          onPressed: () => showTeknisiTutorial(context),
        ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text, this.danger = false, this.onTap});
  final String text;
  final bool danger;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final pill = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color:
            danger ? AppColors.danger.withValues(alpha: 0.1) : AppColors.mist,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Text(text,
          style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: danger ? AppColors.danger : AppColors.tealDeep)),
    );
    return onTap == null ? pill : GestureDetector(onTap: onTap, child: pill);
  }
}

/// Kartu besar job berikutnya dengan aksi lapangan sekali ketuk.
class _NextJobCard extends StatelessWidget {
  const _NextJobCard(
      {required this.job, required this.units, required this.now});
  final TechnicianJob job;
  final int units;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final working = job.status == JobStatus.sedangDikerjakan;
    final address = job.workAddress.trim().isNotEmpty
        ? job.workAddress.trim()
        : job.memberAddress.trim();
    final maps = job.hasWorkLocation ? workMapsUriFor(job) : mapsUriFor(job);
    final phone = job.memberPhone.trim();
    final wa = waUriFor(phone);
    final when = scheduleLabel(job.scheduledDate, now);
    final late = when.startsWith('Terlambat');
    const white70 = Color(0xB3FFFFFF);

    void open(Uri uri) {
      HapticFeedback.selectionClick();
      launchUrl(uri, mode: LaunchMode.externalApplication);
    }

    return AppPressable(
      onTap: () => context.go('/jobs/${job.id}'),
      borderRadius: BorderRadius.circular(AppRadius.xl),
      splash: false,
      child: Container(
        key: const Key('next-job-card'),
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadius.xl),
          gradient: const LinearGradient(
            colors: [
              AppColors.tealDeep,
              AppColors.tealMid,
              AppColors.tealBright
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          boxShadow: [
            BoxShadow(
                color: AppColors.tealDeep.withValues(alpha: 0.25),
                blurRadius: 16,
                offset: const Offset(0, 6)),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                    working
                        ? Icons.build_circle_outlined
                        : Icons.play_circle_outline,
                    color: Colors.white,
                    size: 18),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(working ? 'SEDANG DIKERJAKAN' : 'KERJAKAN SEKARANG',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: AppColors.tealHaze,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.8)),
                ),
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: late
                        ? AppColors.coral
                        : Colors.white.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                  child: Text(when,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w600)),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(job.memberName.isEmpty ? 'Pelanggan' : job.memberName,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(
              [
                job.typeLabel,
                if (units > 1)
                  '$units unit'
                else if (job.unitTitle.isNotEmpty)
                  job.unitTitle
              ].join(' · '),
              style: const TextStyle(color: white70, fontSize: 14),
            ),
            if (address.isNotEmpty) ...[
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.place_outlined, color: white70, size: 16),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(address,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: white70, fontSize: 13)),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                key: const Key('next-job-open'),
                style: FilledButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: AppColors.tealDeep),
                onPressed: () => context.go('/jobs/${job.id}'),
                icon: Icon(working ? Icons.arrow_forward : Icons.play_arrow,
                    size: 18),
                label: Text(working ? 'Lanjutkan Job' : 'Buka Job'),
              ),
            ),
            if (maps != null || phone.isNotEmpty || wa != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  if (maps != null)
                    _QuickAction(
                        key: const Key('next-job-maps'),
                        icon: Icons.navigation_outlined,
                        label: 'Navigasi',
                        onTap: () => open(maps)),
                  if (phone.isNotEmpty)
                    _QuickAction(
                        key: const Key('next-job-call'),
                        icon: Icons.call_outlined,
                        label: 'Telepon',
                        onTap: () => open(Uri(scheme: 'tel', path: phone))),
                  if (wa != null)
                    _QuickAction(
                        key: const Key('next-job-wa'),
                        icon: Icons.chat_outlined,
                        label: 'WhatsApp',
                        onTap: () => open(wa)),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Tombol aksi lapangan (ikon + label kecil), dibagi rata selebar kartu.
class _QuickAction extends StatelessWidget {
  const _QuickAction(
      {super.key,
      required this.icon,
      required this.label,
      required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 3),
          child: Material(
            color: Colors.white.withValues(alpha: 0.16),
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: InkWell(
              borderRadius: BorderRadius.circular(AppRadius.md),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Column(
                  children: [
                    Icon(icon, color: Colors.white, size: 20),
                    const SizedBox(height: 2),
                    Text(label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
}

class _AllClear extends StatelessWidget {
  const _AllClear();

  @override
  Widget build(BuildContext context) => const AppCard(
        child: Row(
          children: [
            Icon(Icons.task_alt, color: AppColors.successGreen, size: 32),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                  'Tidak ada job yang perlu dikerjakan. Job baru dari admin akan muncul di sini.',
                  style: TextStyle(color: AppColors.slate600)),
            ),
          ],
        ),
      );
}

/// Job Ditugaskan yang belum bisa dimulai karena foto Sebelum belum ada.
class _NeedsPhoto extends StatelessWidget {
  const _NeedsPhoto({required this.jobs});
  final List<TechnicianJob> jobs;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.amber.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.amber.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
            child: Row(
              children: [
                const Icon(Icons.photo_camera_outlined,
                    color: AppColors.amber, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('${jobs.length} job perlu foto Sebelum dulu',
                      style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          color: AppColors.slate900)),
                ),
              ],
            ),
          ),
          for (final j in jobs)
            ListTile(
              key: Key('needs-photo-${j.id}'),
              dense: true,
              title: Text(
                  j.memberName.isEmpty ? 'Order ${j.typeLabel}' : j.memberName),
              subtitle: Text([
                j.typeLabel,
                if (j.unitTitle.isNotEmpty) j.unitTitle
              ].join(' · ')),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.go('/jobs/${j.id}'),
            ),
        ],
      ),
    );
  }
}

/// 7 hari mulai hari ini; titik = jumlah job berjadwal. Ketuk = filter daftar,
/// ketuk lagi = kembali ke semua hari.
class _WeekStrip extends StatelessWidget {
  const _WeekStrip(
      {required this.jobs,
      required this.now,
      required this.selected,
      required this.onSelect});
  final List<TechnicianJob> jobs;
  final DateTime now;
  final DateTime? selected;
  final ValueChanged<DateTime> onSelect;

  @override
  Widget build(BuildContext context) {
    final days = [for (var i = 0; i < 7; i++) _day(now).add(Duration(days: i))];
    return Row(
      children: [
        for (final d in days)
          Expanded(
            child: Builder(builder: (context) {
              final count = filterJobs(jobs, day: d).length;
              final isSelected = selected != null && _sameDay(selected!, d);
              final isToday = _sameDay(d, now);
              return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: AppPressable(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    onSelect(d);
                  },
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  pressedScale: 0.94,
                  child: AnimatedContainer(
                    key: Key('day-${d.day}'),
                    duration: AppDurations.base,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? AppColors.tealDeep
                          : (isToday ? AppColors.mist : Colors.white),
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      border: Border.all(
                          color: isSelected
                              ? AppColors.tealDeep
                              : AppColors.slate200),
                    ),
                    child: Column(
                      children: [
                        Text(isToday ? 'Hari ini' : singkatanHari(d),
                            maxLines: 1,
                            overflow: TextOverflow.fade,
                            softWrap: false,
                            style: TextStyle(
                                fontSize: 10,
                                color: isSelected
                                    ? Colors.white70
                                    : AppColors.slate500)),
                        const SizedBox(height: 2),
                        Text('${d.day}',
                            style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.bold,
                                color: isSelected
                                    ? Colors.white
                                    : AppColors.slate900)),
                        const SizedBox(height: 4),
                        SizedBox(
                          height: 6,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              for (var i = 0; i < count.clamp(0, 3); i++)
                                Container(
                                  width: 5,
                                  height: 5,
                                  margin:
                                      const EdgeInsets.symmetric(horizontal: 1),
                                  decoration: BoxDecoration(
                                    color: isSelected
                                        ? Colors.white
                                        : AppColors.tealBright,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ),
      ],
    );
  }
}

class _StatusChips extends StatelessWidget {
  const _StatusChips(
      {required this.jobs, required this.selected, required this.onSelect});
  final List<TechnicianJob> jobs;
  final JobStatus? selected;
  final ValueChanged<JobStatus?> onSelect;

  @override
  Widget build(BuildContext context) {
    final options = <(JobStatus?, String)>[
      (null, 'Semua'),
      (JobStatus.assigned, 'Ditugaskan'),
      (JobStatus.sedangDikerjakan, 'Dikerjakan'),
      (JobStatus.menungguReview, 'Review'),
    ];
    // Wrap (bukan geser ke samping): keempat pilihan selalu terlihat di HP sempit.
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: [
        for (final (status, label) in options)
          ChoiceChip(
            key: Key('status-${status?.value ?? 'semua'}'),
            label: Text(
                '$label ${status == null ? jobs.length : jobs.where((j) => j.status == status).length}'),
            selected: selected == status,
            onSelected: (_) {
              HapticFeedback.selectionClick();
              onSelect(status);
            },
          ),
      ],
    );
  }
}
