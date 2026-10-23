import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/notice_panel.dart';
import '../../core/widgets/status_badge.dart';
import '../../core/utils/error_message.dart';
import '../../data/models/app_user.dart';
import '../../data/models/job_finding.dart';
import '../../data/models/job_photo.dart' show PhotoKind;
import '../../data/models/material_request.dart';
import '../../data/models/technician_job.dart';
import '../pos/cart_state.dart' show formatRupiah;
import '../pos/pos_providers.dart' show techniciansProvider;
import 'job_list_screen.dart' show jobStatusColor;
import 'job_providers.dart';
import 'job_report_pdf.dart';
import 'job_requests_section.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/empty_state.dart';

/// Detail satu job teknisi + aksi berbasis peran & status:
/// teknisi memulai (scan barcode) lalu menyelesaikan (isi diagnosa);
/// admin/kasir menugaskan teknisi; admin membatalkan.
class JobDetailScreen extends ConsumerStatefulWidget {
  const JobDetailScreen({super.key, required this.jobId});

  final String jobId;

  @override
  ConsumerState<JobDetailScreen> createState() => _JobDetailScreenState();
}

class _JobDetailScreenState extends ConsumerState<JobDetailScreen> {
  final _notes = TextEditingController();
  bool _busy = false;
  bool _notesInit = false;

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action, String okMessage) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await action();
      // Tanpa realtime: segarkan detail & daftar setelah perubahan.
      ref.invalidate(jobProvider(widget.jobId));
      ref.invalidate(jobsForCurrentUserProvider);
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(okMessage)));
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(errorMessage(e)),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _start(TechnicianJob job) async {
    final caller = ref.read(updateJobStatusCallerProvider);
    final scanned = await _scanBarcode(
      job.unitBarcode,
      unitLabel: job.unitTitle.isEmpty ? 'unit pada job ini' : job.unitTitle,
    );
    if (scanned == null) return;
    await _run(
      () => caller(
          {'jobId': job.id, 'action': 'start', 'scannedBarcode': scanned}),
      'Barcode cocok — pekerjaan dimulai.',
    );
  }

  Future<void> _saveNotes(TechnicianJob job) =>
      _run(() => saveJobNotes(job.id, _notes.text.trim()), 'Catatan disimpan.');

  Future<void> _submitReview(TechnicianJob job) async {
    final caller = ref.read(updateJobStatusCallerProvider);
    await _run(
      () => caller({
        'jobId': job.id,
        'action': 'submit_review',
        'notes': _notes.text.trim(),
      }),
      'Pekerjaan diajukan, menunggu review admin.',
    );
    ref.invalidate(jobFindingsProvider(job.id));
  }

  Future<void> _cancel(TechnicianJob job) async {
    // Aksi destruktif tanpa undo — minta konfirmasi dulu.
    final yakin = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Batalkan Job?'),
        content: Text(
          'Pekerjaan ${job.typeLabel} untuk ${job.memberName.isNotEmpty ? job.memberName : 'pelanggan ini'} '
          'akan dibatalkan. Tindakan ini tidak bisa dikembalikan.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Tidak jadi'),
          ),
          FilledButton(
            key: const Key('confirm-cancel-job'),
            style: FilledButton.styleFrom(backgroundColor: AppColors.red600),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Ya, batalkan'),
          ),
        ],
      ),
    );
    if (yakin != true) return;

    final caller = ref.read(updateJobStatusCallerProvider);
    await _run(
      () => caller({'jobId': job.id, 'action': 'cancel'}),
      'Job dibatalkan.',
    );
  }

  /// Buka pemindai; kembalikan barcode bila cocok dengan [expected], null bila
  /// dibatalkan. Barcode salah ditolak di dalam sheet (rule 8.2).
  ///
  /// [unitLabel] dipakai sebagai petunjuk di layar — nilai [expected] sendiri
  /// tidak pernah ditampilkan utuh, lihat [_ScanSheet].
  Future<String?> _scanBarcode(String expected, {required String unitLabel}) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (sheetContext) =>
          _ScanSheet(expected: expected, unitLabel: unitLabel),
    );
  }

  /// Buka dialog cetak/simpan Laporan Pekerjaan, dengan umpan balik jelas
  /// (pola sama dengan `_shareReceipt` di invoice_detail_screen.dart).
  Future<void> _printJobReport(
    BuildContext context,
    TechnicianJob job,
    List<MaterialRequest> requests,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final materials = requests
        .where((r) => r.isApproved)
        .expand((r) => r.items)
        .toList(growable: false);
    try {
      await Printing.layoutPdf(
        onLayout: (_) => buildJobReportPdf(job, materials),
        name: 'Laporan-Pekerjaan-${job.id.substring(0, 8)}',
      );
      messenger.showSnackBar(
        const SnackBar(content: Text('Laporan Pekerjaan disiapkan.')),
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(
        content: Text('Gagal menyiapkan laporan: ${errorMessage(e)}'),
        backgroundColor: AppColors.danger,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final jobAsync = ref.watch(jobProvider(widget.jobId));
    final role = ref.watch(currentUserProvider).value?.role;
    final unitId = jobAsync.value?.unitId;
    final requests =
        ref.watch(jobRequestsProvider(widget.jobId)).value ??
            const <MaterialRequest>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Detail Job'),
        actions: [
          // Kasir/admin/teknisi bisa cetak laporan pekerjaan (rangkap kartu
          // garansi) kapan saja job sudah dimuat — cocok dicetak blank di
          // lapangan atau lengkap setelah job selesai.
          if (jobAsync.value != null)
            IconButton(
              key: const Key('print-job-report'),
              icon: const Icon(Icons.print_outlined),
              tooltip: 'Cetak Laporan Pekerjaan',
              onPressed: () =>
                  _printJobReport(context, jobAsync.value!, requests),
            ),
          // Teknisi perlu tahu apa yang pernah dikerjakan pada unit ini.
          if (unitId != null)
            IconButton(
              key: const Key('unit-history'),
              icon: const Icon(Icons.history),
              tooltip: 'Riwayat Service Unit',
              onPressed: () => context.go('/units/$unitId/history'),
            ),
        ],
      ),
      body: jobAsync.when(
        loading: () => const AppSkeletonDetail(),
        error: (e, _) => AppErrorState(error: e),
        data: (job) {
          if (job == null) {
            return const Center(child: Text('Job tidak ditemukan.'));
          }
          if (!_notesInit && job.notes != null) {
            _notes.text = job.notes!;
            _notesInit = true;
          }
          final findings = ref.watch(jobFindingsProvider(job.id)).value;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _HeaderCard(job: job),
              const SizedBox(height: 12),
              _InfoCard(job: job),
              _PaymentBanner(jobId: job.id),
              if (role == UserRole.teknisi &&
                  job.status == JobStatus.sedangDikerjakan &&
                  (job.reviewNote ?? '').isNotEmpty) ...[
                const SizedBox(height: 12),
                NoticePanel(
                  tone: NoticeTone.warning,
                  icon: Icons.undo,
                  text: 'Dikembalikan admin: ${job.reviewNote}',
                ),
              ],
              if ((job.status == JobStatus.assigned ||
                      job.status == JobStatus.sedangDikerjakan) &&
                  role == UserRole.teknisi) ...[
                const SizedBox(height: 12),
                _DiagnosisField(
                  controller: _notes,
                  busy: _busy,
                  onSave: () => _saveNotes(job),
                ),
              ] else if (job.notes != null && job.notes!.isNotEmpty) ...[
                const SizedBox(height: 12),
                _NotesCard(notes: job.notes!),
              ],
              const SizedBox(height: 12),
              _FindingsSection(
                job: job,
                canUpload: role == UserRole.teknisi &&
                    (job.status == JobStatus.assigned ||
                        job.status == JobStatus.sedangDikerjakan),
              ),
              const SizedBox(height: 12),
              JobRequestsSection(job: job),
              const SizedBox(height: 20),
              ..._actions(job, role, findings),
            ],
          );
        },
      ),
    );
  }

  List<Widget> _actions(TechnicianJob job, UserRole? role, List<JobFinding>? loaded) {
    final findings = loaded ?? const <JobFinding>[];
    final hasBefore = findings.any((f) => f.hasBefore);
    final isTeknisi = role == UserRole.teknisi;
    final isAdmin = role == UserRole.admin;
    final isKasir = role == UserRole.kasir;
    final widgets = <Widget>[];

    // Teknisi: mulai / selesaikan job miliknya.
    if (isTeknisi) {
      if (job.status == JobStatus.assigned) {
        // Server mewajibkan: unit ber-barcode, minimal satu foto SEBELUM pada temuan.
        final noBarcode = job.unitId == null || job.unitBarcode.isEmpty;
        if (noBarcode) {
          widgets.add(const NoticePanel(
            tone: NoticeTone.warning,
            icon: Icons.lock_outline,
            text: 'Unit pada job ini belum punya barcode. Hubungi admin.',
          ));
          widgets.add(const SizedBox(height: 10));
        } else if (!hasBefore) {
          widgets.add(const NoticePanel(
            tone: NoticeTone.warning,
            icon: Icons.lock_outline,
            text: 'Tambah temuan dan unggah foto SEBELUM dulu untuk memulai pekerjaan.',
          ));
          widgets.add(const SizedBox(height: 10));
        }
        widgets.add(_primaryButton(
          icon: Icons.qr_code_scanner,
          label: 'Mulai Pekerjaan',
          onPressed: (hasBefore && !noBarcode) ? () => _start(job) : null,
        ));
      } else if (job.status == JobStatus.sedangDikerjakan) {
        final blocked = loaded == null ? null : submitBlockedReason(job, findings);
        if (blocked != null) {
          widgets.add(NoticePanel(
            tone: NoticeTone.warning,
            icon: Icons.hourglass_empty,
            text: blocked,
          ));
          widgets.add(const SizedBox(height: 10));
        }
        widgets.add(_primaryButton(
          icon: Icons.check_circle_outline,
          label: 'Ajukan Selesai',
          onPressed: (loaded != null && blocked == null) ? () => _submitReview(job) : null,
        ));
      }
    }

    // Admin/Kasir: tugaskan/ganti teknisi selama belum dikerjakan.
    if ((isAdmin || isKasir) &&
        (job.status == JobStatus.menungguPenugasan ||
            job.status == JobStatus.assigned)) {
      widgets.add(_AssignPanel(job: job, busy: _busy, onAssigned: () {}));
    }

    // Admin: batalkan job yang belum selesai.
    if (isAdmin &&
        job.status != JobStatus.selesai &&
        job.status != JobStatus.dibatalkan) {
      widgets.add(const SizedBox(height: 10));
      widgets.add(SizedBox(
        height: 48,
        child: OutlinedButton.icon(
          onPressed: _busy ? null : () => _cancel(job),
          icon: const Icon(Icons.cancel_outlined, color: AppColors.coral),
          label: const Text('Batalkan Job'),
          style: AppButtonStyles.destructive(),
        ),
      ));
    }

    if (widgets.isEmpty) {
      widgets.add(_StatusHint(status: job.status));
    }
    return widgets;
  }

  Widget _primaryButton({
    required IconData icon,
    required String label,
    required VoidCallback? onPressed,
  }) {
    return SizedBox(
      height: 52,
      child: FilledButton.icon(
        onPressed: (_busy || onPressed == null) ? null : onPressed,
        icon: _busy
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: Colors.white))
            : Icon(icon),
        label: Text(label),
      ),
    );
  }
}

/// Isi peringatan tagihan, atau null bila tidak perlu diperingatkan sama
/// sekali: job tanpa invoice (order manual belum ditagih) atau sudah lunas.
///
/// [mendesak] true saat belum ada pembayaran sepeser pun — dibedakan dari
/// DP/kurang bayar yang sudah sebagian tertagih.
({String judul, bool mendesak})? paymentWarningFor(JobPaymentInfo? info) {
  if (info == null || !info.hasInvoice || info.outstanding <= 0) return null;
  final mendesak = info.totalPaid <= 0;
  return (
    judul: mendesak ? 'Tagihan belum dibayar' : 'Tagihan ${info.status.label}',
    mendesak: mendesak,
  );
}

/// Peringatan status bayar — BUKAN blokir. Job tetap boleh dimulai walau
/// belum lunas (jasa AC lazim ditagih setelah pekerjaan selesai); teknisi
/// hanya diberi tahu supaya bisa menagih di tempat.
class _PaymentBanner extends ConsumerWidget {
  const _PaymentBanner({required this.jobId});
  final String jobId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final info = ref.watch(jobPaymentInfoProvider(jobId)).value;
    final warning = paymentWarningFor(info);
    if (warning == null) return const SizedBox.shrink();

    final belumSamaSekali = warning.mendesak;
    final color = belumSamaSekali ? AppColors.danger : AppColors.warning;

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Container(
        key: const Key('job-payment-banner'),
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              belumSamaSekali
                  ? Icons.error_outline
                  : Icons.account_balance_wallet_outlined,
              size: 20,
              color: color,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    warning.judul,
                    style: TextStyle(
                        fontWeight: FontWeight.w700, color: color),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${info!.number} • sisa ${formatRupiah(info.outstanding)} '
                    'dari ${formatRupiah(info.grandTotal)}',
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.slate600),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeaderCard extends StatelessWidget {
  const _HeaderCard({required this.job});
  final TechnicianJob job;

  @override
  Widget build(BuildContext context) {
    final color = jobStatusColor(job.status);
    final title = job.memberName.isNotEmpty
        ? job.memberName
        : (job.unitTitle.isEmpty ? 'Job servis' : job.unitTitle);
    final unit = job.unitTitle.isEmpty
        ? ''
        : ' · ${job.unitTitle}${job.unitRoom.isEmpty ? '' : ' (${job.unitRoom})'}';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: AppColors.teal50,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: const Icon(Icons.handyman_outlined,
                      color: AppColors.teal700, size: 26),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                          color: AppColors.slate900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text('${job.typeLabel}$unit',
                          style: const TextStyle(color: AppColors.slate500)),
                    ],
                  ),
                ),
                StatusBadge(label: job.status.label, color: color),
              ],
            ),
            const SizedBox(height: 12),
            _JobSteps(status: job.status),
          ],
        ),
      ),
    );
  }
}

/// Posisi job di alurnya: Ditugaskan, Dikerjakan, Review admin, Selesai (seperti web).
class _JobSteps extends StatelessWidget {
  const _JobSteps({required this.status});
  final JobStatus status;

  static const _steps = [
    (JobStatus.assigned, 'Ditugaskan'),
    (JobStatus.sedangDikerjakan, 'Dikerjakan'),
    (JobStatus.menungguReview, 'Review admin'),
    (JobStatus.selesai, 'Selesai'),
  ];

  @override
  Widget build(BuildContext context) {
    if (status == JobStatus.dibatalkan) return const SizedBox.shrink();
    final idx = status == JobStatus.menungguPenugasan
        ? -1
        : _steps.indexWhere((s) => s.$1 == status);
    return Wrap(
      key: const Key('job-steps'),
      spacing: 8,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        for (final (i, step) in _steps.indexed)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 20,
                height: 20,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: i < idx ? AppColors.teal700 : Colors.transparent,
                  border: Border.all(
                      color: i <= idx ? AppColors.teal700 : AppColors.slate300),
                ),
                child: Text(
                  i < idx ? '✓' : '${i + 1}',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: i == idx ? FontWeight.bold : FontWeight.normal,
                    color: i < idx
                        ? Colors.white
                        : (i == idx ? AppColors.teal700 : AppColors.slate400),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Text(
                step.$2,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: i == idx ? FontWeight.w600 : FontWeight.normal,
                  color: i == idx ? AppColors.slate900 : AppColors.slate500,
                ),
              ),
              if (i < _steps.length - 1)
                Container(
                  width: 14,
                  height: 1,
                  margin: const EdgeInsets.only(left: 8),
                  color: AppColors.slate300,
                ),
            ],
          ),
      ],
    );
  }
}

/// Link lokasi: link Google Maps yang diisi admin/kasir (hanya http/https); bila kosong,
/// cari alamat teksnya di Google Maps; bila alamat juga kosong, tidak ada link.
Uri? mapsUriFor(TechnicianJob job) {
  final url = job.memberMapsUrl.trim();
  if (RegExp(r'^https?://', caseSensitive: false).hasMatch(url)) return Uri.tryParse(url);
  final address = job.memberAddress.trim();
  if (address.isEmpty) return null;
  return Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': address});
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.job});
  final TechnicianJob job;

  @override
  Widget build(BuildContext context) {
    final maps = mapsUriFor(job);
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Column(
          children: [
            _row(Icons.person_outline, 'Pelanggan',
                job.memberName.isEmpty ? '-' : job.memberName),
            const Divider(height: 1),
            _row(Icons.phone_outlined, 'No. HP',
                job.memberPhone.isEmpty ? '-' : job.memberPhone),
            const Divider(height: 1),
            _row(Icons.location_on_outlined, 'Alamat',
                job.memberAddress.isEmpty ? '-' : job.memberAddress),
            const Divider(height: 1),
            _rowWidget(
              Icons.map_outlined,
              'Lokasi',
              maps == null
                  ? const Text('-',
                      style: TextStyle(color: AppColors.slate900, fontSize: 14, fontWeight: FontWeight.w600))
                  : InkWell(
                      key: const Key('open-maps'),
                      onTap: () => launchUrl(maps, mode: LaunchMode.externalApplication),
                      child: const Text('Buka di Maps',
                          style: TextStyle(
                              color: AppColors.teal700,
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              decoration: TextDecoration.underline)),
                    ),
            ),
            if (job.unitId != null) ...[
              const Divider(height: 1),
              _row(Icons.ac_unit, 'Unit AC',
                  job.unitTitle.isEmpty ? '-' : job.unitTitle),
              if (job.unitParts.isNotEmpty) ...[
                const Divider(height: 1),
                _row(Icons.inventory_2_outlined, 'Unit dalam paket', job.unitParts),
              ],
              const Divider(height: 1),
              _row(Icons.meeting_room_outlined, 'Ruangan',
                  job.unitRoom.isEmpty ? '-' : job.unitRoom),
              const Divider(height: 1),
              _row(Icons.qr_code, 'Barcode',
                  job.unitBarcode.isEmpty ? 'Belum digenerate' : job.unitBarcode),
            ],
            if (job.technicianName.isNotEmpty) ...[
              const Divider(height: 1),
              _row(Icons.badge_outlined, 'Teknisi', job.technicianName),
            ],
            if (job.startedAt != null) ...[
              const Divider(height: 1),
              _row(Icons.play_circle_outline, 'Mulai',
                  _formatDate(job.startedAt!)),
            ],
            if (job.completedAt != null) ...[
              const Divider(height: 1),
              _row(Icons.check_circle_outline, 'Selesai',
                  _formatDate(job.completedAt!)),
            ],
          ],
        ),
      ),
    );
  }

  Widget _row(IconData icon, String label, String value) => _rowWidget(
        icon,
        label,
        Text(
          value,
          textAlign: TextAlign.right,
          style: const TextStyle(
            color: AppColors.slate900,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      );

  Widget _rowWidget(IconData icon, String label, Widget value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 13),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppColors.slate400),
          const SizedBox(width: 14),
          Text(label,
              style: const TextStyle(color: AppColors.slate500, fontSize: 14)),
          const Spacer(),
          Flexible(child: Align(alignment: Alignment.centerRight, child: value)),
        ],
      ),
    );
  }
}

class _DiagnosisField extends StatelessWidget {
  const _DiagnosisField({
    required this.controller,
    required this.onSave,
    required this.busy,
  });
  final TextEditingController controller;
  final VoidCallback onSave;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Diagnosa / Catatan Pengerjaan',
                style: TextStyle(
                    fontWeight: FontWeight.w600, color: AppColors.slate900)),
            const SizedBox(height: 10),
            TextField(
              key: const Key('job-notes'),
              controller: controller,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Tuliskan hasil pengecekan atau tindakan…',
              ),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                key: const Key('save-notes'),
                onPressed: busy ? null : onSave,
                child: const Text('Simpan Catatan'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotesCard extends StatelessWidget {
  const _NotesCard({required this.notes});
  final String notes;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Diagnosa / Catatan',
                style: TextStyle(
                    fontWeight: FontWeight.w600, color: AppColors.slate900)),
            const SizedBox(height: 6),
            Text(notes, style: const TextStyle(color: AppColors.slate600)),
          ],
        ),
      ),
    );
  }
}

class _StatusHint extends StatelessWidget {
  const _StatusHint({required this.status});
  final JobStatus status;

  @override
  Widget build(BuildContext context) {
    final text = switch (status) {
      JobStatus.menungguPenugasan => 'Menunggu penugasan teknisi oleh Admin.',
      JobStatus.assigned => 'Menunggu teknisi memulai pekerjaan.',
      JobStatus.sedangDikerjakan => 'Sedang dikerjakan teknisi.',
      JobStatus.menungguReview => 'Menunggu review admin.',
      JobStatus.selesai => 'Pekerjaan telah selesai.',
      JobStatus.dibatalkan => 'Job dibatalkan.',
    };
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.slate100,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline, size: 20, color: AppColors.slate500),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text,
                style: const TextStyle(color: AppColors.slate600)),
          ),
        ],
      ),
    );
  }
}

/// Petunjuk kuning saat sebuah aksi terkunci oleh prasyarat (mis. foto sebelum).
/// Panel penugasan teknisi (admin/kasir): dropdown teknisi aktif + tombol simpan.
class _AssignPanel extends ConsumerStatefulWidget {
  const _AssignPanel({required this.job, required this.busy, required this.onAssigned});

  final TechnicianJob job;
  final bool busy;
  final VoidCallback onAssigned;

  @override
  ConsumerState<_AssignPanel> createState() => _AssignPanelState();
}

class _AssignPanelState extends ConsumerState<_AssignPanel> {
  String? _selected;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _selected = widget.job.technicianId;
  }

  Future<void> _assign() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(assignTechnicianCallerProvider)(
        {'jobId': widget.job.id, 'technicianId': _selected ?? ''},
      );
      ref.invalidate(jobProvider(widget.job.id));
      ref.invalidate(jobsForCurrentUserProvider);
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Teknisi ditugaskan.')),
      );
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(errorMessage(e)),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final techsAsync = ref.watch(techniciansProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Tugaskan Teknisi',
                style: TextStyle(
                    fontWeight: FontWeight.w600, color: AppColors.slate900)),
            const SizedBox(height: 10),
            techsAsync.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => Text('Gagal memuat teknisi: ${errorMessage(e)}',
                  style: const TextStyle(color: AppColors.slate500)),
              data: (list) => AppSelectField<String?>(
                fieldKey: const Key('assign-technician'),
                label: 'Teknisi',
                value:
                    list.any((t) => t.uid == _selected) ? _selected : null,
                items: [
                  const DropdownMenuItem<String?>(
                    value: null,
                    child: Text('Belum ditentukan'),
                  ),
                  for (final t in list)
                    DropdownMenuItem<String?>(
                        value: t.uid, child: Text(t.name)),
                ],
                onChanged: (v) => setState(() => _selected = v),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 48,
              width: double.infinity,
              child: FilledButton(
                onPressed: (_busy || widget.busy) ? null : _assign,
                child: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Simpan Penugasan'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Sheet pemindai barcode; pop dengan nilai barcode saat cocok [expected].
///
/// [expected] TIDAK pernah ditampilkan utuh: scan barcode adalah bukti bahwa
/// teknisi benar-benar berada di depan unit, jadi menuliskan barcodenya di
/// layar sama saja memberi jawabannya untuk diketik lewat input manual.
/// Yang ditampilkan hanya identitas unit + 4 karakter terakhir barcode,
/// cukup untuk memastikan unit yang benar tanpa bisa direkonstruksi.
class _ScanSheet extends StatefulWidget {
  const _ScanSheet({required this.expected, required this.unitLabel});
  final String expected;
  final String unitLabel;

  @override
  State<_ScanSheet> createState() => _ScanSheetState();
}

class _ScanSheetState extends State<_ScanSheet> {
  bool _handled = false;

  /// 4 karakter terakhir barcode — pembeda antar unit di alamat yang sama,
  /// tapi terlalu sedikit untuk diketik di input manual.
  String get _barcodeHint {
    final value = widget.expected.trim();
    return value.length <= 4 ? '' : '…${value.substring(value.length - 4)}';
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    final raw =
        capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
    if (raw == null) return;
    if (raw.trim() == widget.expected.trim()) {
      _handled = true;
      Navigator.of(context).pop(raw.trim());
    } else {
      setState(() {}); // pertahankan pesan mismatch
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Barcode tidak sesuai unit pada job ini')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.slate300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 14),
            const Text('Scan Barcode Unit',
                style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: AppColors.slate900)),
            const SizedBox(height: 4),
            Text(
              'Pindai barcode pada ${widget.unitLabel}'
              '${_barcodeHint.isEmpty ? '' : ' (berakhiran $_barcodeHint)'}',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.slate500),
            ),
            const SizedBox(height: 14),
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: SizedBox(
                height: 260,
                child: MobileScanner(
                  onDetect: _onDetect,
                  errorBuilder: (context, error, child) => Container(
                    color: AppColors.slate900,
                    child: const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'Kamera tidak tersedia.\nGunakan input manual.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white70),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            _ManualEntry(onSubmit: _onManual),
          ],
        ),
      ),
    );
  }

  void _onManual(String value) {
    if (value.trim() == widget.expected.trim()) {
      Navigator.of(context).pop(value.trim());
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Barcode tidak sesuai unit pada job ini')),
      );
    }
  }
}

class _ManualEntry extends StatefulWidget {
  const _ManualEntry({required this.onSubmit});
  final ValueChanged<String> onSubmit;

  @override
  State<_ManualEntry> createState() => _ManualEntryState();
}

class _ManualEntryState extends State<_ManualEntry> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: AppTextField(
            key: const Key('job-scan-manual'),
            label: 'Input barcode manual',
            hint: 'Ketik kode di bodi unit',
            controller: _controller,
            prefixIcon: const Icon(Icons.qr_code, size: 18),
            textInputAction: TextInputAction.search,
            onFieldSubmitted: widget.onSubmit,
          ),
        ),
        const SizedBox(width: 10),
        SizedBox(
          height: 50,
          child: FilledButton(
            onPressed: () => widget.onSubmit(_controller.text),
            child: const Text('Cek'),
          ),
        ),
      ],
    );
  }
}

/// Kartu temuan: tiap temuan punya foto Sebelum dan Sesudah. Teknisi pemilik
/// job bisa menambah temuan + foto selama job aktif; peran lain hanya melihat.
class _FindingsSection extends ConsumerStatefulWidget {
  const _FindingsSection({required this.job, required this.canUpload});

  final TechnicianJob job;
  final bool canUpload;

  @override
  ConsumerState<_FindingsSection> createState() => _FindingsSectionState();
}

class _FindingsSectionState extends ConsumerState<_FindingsSection> {
  bool _busy = false;

  Future<void> _guard(Future<void> Function() action, String okMessage) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await action();
      ref.invalidate(jobFindingsProvider(widget.job.id));
      ref.invalidate(jobProvider(widget.job.id));
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(okMessage)));
    } catch (e) {
      ref.invalidate(jobFindingsProvider(widget.job.id));
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(errorMessage(e)),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addFinding() async {
    final result = await showModalBottomSheet<({List<String> names, String note})>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _AddFindingSheet(),
    );
    if (result == null) return;
    await _guard(() async {
      // Berurutan supaya urutan temuan sesuai urutan ketikan (sama seperti web).
      for (final name in result.names) {
        await addFinding(widget.job.id, categoryName: name, note: result.note);
      }
    }, result.names.length > 1 ? '${result.names.length} temuan ditambahkan.' : 'Temuan ditambahkan.');
  }

  Future<void> _addPhoto(JobFinding finding, PhotoKind kind) async {
    final source = await _pickSource();
    if (source == null) return;
    final picker = ImagePicker();
    // Galeri boleh banyak foto sekaligus; kamera satu per jepretan.
    final files = source == ImageSource.gallery
        ? await picker.pickMultiImage(maxWidth: 1600, imageQuality: 80)
        : [
            if (await picker.pickImage(
                    source: source, maxWidth: 1600, imageQuality: 80)
                case final XFile f)
              f,
          ];
    if (files.isEmpty || !mounted) return;
    await _guard(() async {
      for (final file in files) {
        final bytes = await file.readAsBytes();
        final ext = file.name.contains('.') ? file.name.split('.').last : 'jpg';
        await ref.read(jobRepositoryProvider).uploadFindingPhoto(
              jobId: widget.job.id,
              findingId: finding.id,
              kind: kind,
              bytes: bytes,
              ext: ext,
              contentType: file.mimeType ?? 'image/jpeg',
            );
      }
    }, files.length > 1 ? '${files.length} foto ${kind.label.toLowerCase()} tersimpan.' : 'Foto ${kind.label.toLowerCase()} tersimpan.');
  }

  Future<ImageSource?> _pickSource() {
    return showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Kamera'),
              onTap: () => Navigator.of(ctx).pop(ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Galeri'),
              onTap: () => Navigator.of(ctx).pop(ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final findingsAsync = ref.watch(jobFindingsProvider(widget.job.id));
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text('Temuan & Foto Sebelum/Sesudah',
                      style: TextStyle(
                          fontWeight: FontWeight.w600, color: AppColors.slate900)),
                ),
                if (widget.canUpload)
                  TextButton.icon(
                    key: const Key('add-finding'),
                    onPressed: _busy ? null : _addFinding,
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Tambah Temuan'),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            findingsAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: LinearProgressIndicator(),
              ),
              error: (e, _) => Text('Gagal memuat temuan: ${errorMessage(e)}',
                  style: const TextStyle(color: AppColors.slate500)),
              data: (findings) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (findings.isEmpty)
                      Text(
                        widget.canUpload
                            ? 'Belum ada temuan. Tambahkan minimal satu temuan, lalu unggah foto sebelum & sesudah.'
                            : 'Belum ada temuan dicatat.',
                        style: const TextStyle(color: AppColors.slate500),
                      ),
                    for (final f in findings) ...[
                      _FindingTile(
                        finding: f,
                        canUpload: widget.canUpload,
                        busy: _busy,
                        onAdd: (kind) => _addPhoto(f, kind),
                      ),
                      const SizedBox(height: 10),
                    ],
                    if (widget.canUpload)
                      _SendFindingsBar(
                        job: widget.job,
                        findings: findings,
                        busy: _busy,
                        onSend: () => _guard(
                          () => sendFindings(widget.job.id),
                          widget.job.findingsSentAt == null
                              ? 'Temuan terkirim ke kasir dan admin.'
                              : 'Temuan dikirim ulang.',
                        ),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Bar "Sudah selesai mencatat temuan?": kirim ke kasir/admin supaya mereka menetapkan
/// tindakan dan harga jasa. Tombol mati sampai ada temuan dan tiap temuan berfoto sebelum.
class _SendFindingsBar extends StatelessWidget {
  const _SendFindingsBar({
    required this.job,
    required this.findings,
    required this.busy,
    required this.onSend,
  });

  final TechnicianJob job;
  final List<JobFinding> findings;
  final bool busy;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final withoutBefore = findings.where((f) => !f.hasBefore).length;
    final sentAt = job.findingsSentAt;
    final enabled = findings.isNotEmpty && withoutBefore == 0 && !busy;
    const hint = TextStyle(fontSize: 12, color: AppColors.slate500);
    return Container(
      key: const Key('send-findings-bar'),
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Sudah selesai mencatat temuan?',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
          const SizedBox(height: 2),
          const Text(
              'Kirim ke kasir dan admin supaya mereka menentukan tindakan dan harga jasanya.',
              style: hint),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: OutlinedButton.icon(
              key: const Key('send-findings'),
              onPressed: enabled ? onSend : null,
              icon: const Icon(Icons.send_outlined, size: 18),
              label: Text(sentAt != null ? 'Kirim Ulang Temuan' : 'Kirim Temuan'),
            ),
          ),
          if (findings.isEmpty) ...[
            const SizedBox(height: 6),
            const Text('Tambah minimal 1 temuan dulu.', style: hint),
          ] else if (withoutBefore > 0) ...[
            const SizedBox(height: 6),
            Text(
                'Isi foto sebelum dulu: $withoutBefore dari ${findings.length} temuan belum punya foto sebelum.',
                style: hint),
          ],
          if (sentAt != null && !job.priced) ...[
            const SizedBox(height: 6),
            Text(
                'Temuan terkirim ${_formatDate(sentAt)}. Menunggu harga jasa dari kasir/admin.',
                style: const TextStyle(fontSize: 12, color: AppColors.warning)),
          ],
          if (job.priced) ...[
            const SizedBox(height: 6),
            const Text('Harga jasa sudah ditetapkan.',
                style: TextStyle(fontSize: 12, color: AppColors.success)),
          ],
        ],
      ),
    );
  }
}

/// Sheet tambah temuan: ketik kategori (koma atau Enter memecahnya jadi beberapa temuan,
/// tiap satu jadi chip), dengan saran dari kategori yang sudah ada, plus satu catatan bersama.
class _AddFindingSheet extends ConsumerStatefulWidget {
  const _AddFindingSheet();

  @override
  ConsumerState<_AddFindingSheet> createState() => _AddFindingSheetState();
}

class _AddFindingSheetState extends ConsumerState<_AddFindingSheet> {
  final _name = TextEditingController();
  final _note = TextEditingController();
  final List<String> _pending = [];
  List<String> _suggestions = const [];

  @override
  void dispose() {
    _name.dispose();
    _note.dispose();
    super.dispose();
  }

  void _addPending(Iterable<String> names) {
    for (final raw in names) {
      final name = raw.trim();
      if (name.isEmpty) continue;
      if (_pending.any((p) => p.toLowerCase() == name.toLowerCase())) continue;
      _pending.add(name);
    }
  }

  void _onChanged(String value) {
    if (value.contains(',')) {
      // Semua bagian sebelum koma terakhir jadi chip (termasuk hasil paste "A, B, C").
      final parts = value.split(',');
      final rest = parts.removeLast();
      setState(() {
        _addPending(parts);
        _name.text = rest.trimLeft();
        _name.selection = TextSelection.collapsed(offset: _name.text.length);
        _suggestions = const [];
      });
      return;
    }
    _suggest(value);
  }

  Future<void> _suggest(String q) async {
    if (q.trim().isEmpty) {
      setState(() => _suggestions = const []);
      return;
    }
    try {
      final r = await ref.read(jobRepositoryProvider).searchCategories(q.trim());
      if (mounted && q == _name.text) setState(() => _suggestions = r);
    } catch (_) {
      // Saran hanya bantuan; ketik bebas tetap bisa disimpan.
    }
  }

  List<String> _all() {
    final names = [..._pending];
    final draft = _name.text.trim();
    if (draft.isNotEmpty && !names.any((p) => p.toLowerCase() == draft.toLowerCase())) {
      names.add(draft);
    }
    return names;
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 16, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Tambah Temuan',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            const Text('Pisahkan beberapa temuan dengan koma atau Enter.',
                style: TextStyle(fontSize: 12, color: AppColors.slate500)),
            const SizedBox(height: 12),
            if (_pending.isNotEmpty) ...[
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final p in _pending)
                    InputChip(
                      label: Text(p),
                      onDeleted: () => setState(() => _pending.remove(p)),
                    ),
                ],
              ),
              const SizedBox(height: 8),
            ],
            TextField(
              key: const Key('finding-name'),
              controller: _name,
              onChanged: _onChanged,
              onSubmitted: (_) => setState(() {
                _addPending([_name.text]);
                _name.clear();
                _suggestions = const [];
              }),
              decoration: InputDecoration(
                labelText: 'Masalah / kategori',
                hintText: _pending.isEmpty
                    ? 'mis. Freon kurang, Filter kotor'
                    : 'Temuan berikutnya...',
              ),
            ),
            if (_suggestions.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  for (final s in _suggestions)
                    ActionChip(
                      label: Text(s),
                      onPressed: () => setState(() {
                        _addPending([s]);
                        _name.clear();
                        _suggestions = const [];
                      }),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              key: const Key('finding-note'),
              controller: _note,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Catatan (opsional)'),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton(
                key: const Key('finding-save'),
                onPressed: () {
                  final names = _all();
                  if (names.isEmpty) return;
                  Navigator.of(context).pop((names: names, note: _note.text.trim()));
                },
                child: const Text('Simpan Temuan'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Satu temuan: judul + badge asal, catatan, lalu dua baris foto (sebelum/sesudah).
class _FindingTile extends StatelessWidget {
  const _FindingTile({
    required this.finding,
    required this.canUpload,
    required this.busy,
    required this.onAdd,
  });

  final JobFinding finding;
  final bool canUpload;
  final bool busy;
  final ValueChanged<PhotoKind> onAdd;

  @override
  Widget build(BuildContext context) {
    final fromComplaint = finding.origin == 'komplain_awal';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.slate300),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(finding.title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, color: AppColors.slate900)),
              ),
              const SizedBox(width: 8),
              StatusBadge(
                label: fromComplaint ? 'Keluhan Awal' : 'Ditambah Teknisi',
                color: fromComplaint ? AppColors.blue600 : AppColors.slate500,
              ),
            ],
          ),
          if ((finding.note ?? '').isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(finding.note!,
                style: const TextStyle(color: AppColors.slate600, fontSize: 13)),
          ],
          const SizedBox(height: 10),
          for (final kind in PhotoKind.values) ...[
            _PhotoGroup(
              kind: kind,
              photos: finding.photos.where((p) => p.kind == kind).toList(),
              canUpload: canUpload,
              busy: busy,
              onAdd: () => onAdd(kind),
            ),
            if (kind != PhotoKind.values.last) const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}

/// Satu baris kelompok foto (sebelum/sesudah): label + thumbnail horizontal.
class _PhotoGroup extends StatelessWidget {
  const _PhotoGroup({
    required this.kind,
    required this.photos,
    required this.canUpload,
    required this.busy,
    required this.onAdd,
  });

  final PhotoKind kind;
  final List<JobFindingPhoto> photos;
  final bool canUpload;
  final bool busy;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('${kind.label} (${photos.length})',
            style: const TextStyle(
                color: AppColors.slate500,
                fontSize: 13,
                fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        SizedBox(
          height: 88,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final p in photos) _Thumb(photo: p),
              if (canUpload) _AddTile(busy: busy, onTap: onAdd),
              if (photos.isEmpty && !canUpload)
                const _EmptyThumb(),
            ],
          ),
        ),
      ],
    );
  }
}

class _Thumb extends ConsumerWidget {
  const _Thumb({required this.photo});
  final JobFindingPhoto photo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final urlAsync = ref.watch(signedPhotoUrlProvider(photo.path));
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: urlAsync.when(
        loading: () => const _ThumbBox(child: Center(
          child: SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2)),
        )),
        error: (_, __) => const _ThumbBox(
          child: Icon(Icons.broken_image_outlined, color: AppColors.slate400),
        ),
        data: (url) => GestureDetector(
          onTap: () => _openViewer(context, url),
          child: _ThumbBox(
            child: Image.network(url, fit: BoxFit.cover),
          ),
        ),
      ),
    );
  }

  void _openViewer(BuildContext context, String url) {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          title: Text(photo.kind.label),
        ),
        body: Center(
          child: InteractiveViewer(
            child: Image.network(url, fit: BoxFit.contain),
          ),
        ),
      ),
    ));
  }
}

class _ThumbBox extends StatelessWidget {
  const _ThumbBox({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Container(
        width: 88,
        height: 88,
        color: AppColors.slate100,
        child: child,
      ),
    );
  }
}

class _EmptyThumb extends StatelessWidget {
  const _EmptyThumb();

  @override
  Widget build(BuildContext context) {
    return const _ThumbBox(
      child: Center(
        child: Text('Belum ada',
            style: TextStyle(color: AppColors.slate400, fontSize: 12)),
      ),
    );
  }
}

class _AddTile extends StatelessWidget {
  const _AddTile({required this.busy, required this.onTap});
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: busy ? null : onTap,
      child: Container(
        width: 88,
        height: 88,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: AppColors.slate300),
          color: AppColors.teal50,
        ),
        child: Center(
          child: busy
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.add_a_photo_outlined,
                        color: AppColors.teal700),
                    SizedBox(height: 4),
                    Text('Tambah',
                        style: TextStyle(
                            color: AppColors.teal700, fontSize: 12)),
                  ],
                ),
        ),
      ),
    );
  }
}

String _formatDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
}
