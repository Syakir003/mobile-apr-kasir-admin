import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/app_user.dart';
import '../../data/models/technician_job.dart';
import '../pos/pos_providers.dart' show techniciansProvider;
import 'job_list_screen.dart' show jobStatusColor;
import 'job_providers.dart';

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
        content: Text('$e'.replaceFirst('Exception: ', '')),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _start(TechnicianJob job) async {
    final caller = ref.read(updateJobStatusCallerProvider);
    // Tanpa unit terkait: mulai langsung. Dengan unit: wajib scan cocok.
    if (job.unitId == null || job.unitBarcode.isEmpty) {
      await _run(
        () => caller({'jobId': job.id, 'action': 'start'}),
        'Pekerjaan dimulai.',
      );
      return;
    }
    final scanned = await _scanBarcode(job.unitBarcode);
    if (scanned == null) return;
    await _run(
      () => caller(
          {'jobId': job.id, 'action': 'start', 'scannedBarcode': scanned}),
      'Barcode cocok — pekerjaan dimulai.',
    );
  }

  Future<void> _complete(TechnicianJob job) async {
    final caller = ref.read(updateJobStatusCallerProvider);
    await _run(
      () => caller({
        'jobId': job.id,
        'action': 'complete',
        'notes': _notes.text.trim(),
      }),
      'Pekerjaan selesai.',
    );
  }

  Future<void> _cancel(TechnicianJob job) async {
    final caller = ref.read(updateJobStatusCallerProvider);
    await _run(
      () => caller({'jobId': job.id, 'action': 'cancel'}),
      'Job dibatalkan.',
    );
  }

  /// Buka pemindai; kembalikan barcode bila cocok dengan [expected], null bila
  /// dibatalkan. Barcode salah ditolak di dalam sheet (rule 8.2).
  Future<String?> _scanBarcode(String expected) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (sheetContext) => _ScanSheet(expected: expected),
    );
  }

  @override
  Widget build(BuildContext context) {
    final jobAsync = ref.watch(jobProvider(widget.jobId));
    final role = ref.watch(currentUserProvider).value?.role;

    return Scaffold(
      appBar: AppBar(title: const Text('Detail Job')),
      body: jobAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Gagal memuat: $e')),
        data: (job) {
          if (job == null) {
            return const Center(child: Text('Job tidak ditemukan.'));
          }
          if (!_notesInit && job.notes != null) {
            _notes.text = job.notes!;
            _notesInit = true;
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _HeaderCard(job: job),
              const SizedBox(height: 12),
              _InfoCard(job: job),
              if (job.status == JobStatus.sedangDikerjakan &&
                  role == UserRole.teknisi) ...[
                const SizedBox(height: 12),
                _DiagnosisField(controller: _notes),
              ] else if (job.notes != null && job.notes!.isNotEmpty) ...[
                const SizedBox(height: 12),
                _NotesCard(notes: job.notes!),
              ],
              const SizedBox(height: 20),
              ..._actions(job, role),
            ],
          );
        },
      ),
    );
  }

  List<Widget> _actions(TechnicianJob job, UserRole? role) {
    final isTeknisi = role == UserRole.teknisi;
    final isAdmin = role == UserRole.admin;
    final isKasir = role == UserRole.kasir;
    final widgets = <Widget>[];

    // Teknisi: mulai / selesaikan job miliknya.
    if (isTeknisi) {
      if (job.status == JobStatus.assigned) {
        widgets.add(_primaryButton(
          icon: Icons.qr_code_scanner,
          label: 'Mulai Pekerjaan',
          onPressed: () => _start(job),
        ));
      } else if (job.status == JobStatus.sedangDikerjakan) {
        widgets.add(_primaryButton(
          icon: Icons.check_circle_outline,
          label: 'Selesaikan Pekerjaan',
          onPressed: () => _complete(job),
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
          icon: const Icon(Icons.cancel_outlined, color: AppColors.red600),
          label: const Text('Batalkan Job'),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.red600,
            side: const BorderSide(color: Color(0xFFFECACA)),
          ),
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
    required VoidCallback onPressed,
  }) {
    return SizedBox(
      height: 52,
      child: FilledButton.icon(
        onPressed: _busy ? null : onPressed,
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

class _HeaderCard extends StatelessWidget {
  const _HeaderCard({required this.job});
  final TechnicianJob job;

  @override
  Widget build(BuildContext context) {
    final color = jobStatusColor(job.status);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
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
                    job.unitTitle.isEmpty ? 'Order ${job.typeLabel}' : job.unitTitle,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: AppColors.slate900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(job.typeLabel,
                      style: const TextStyle(color: AppColors.slate500)),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                job.status.label,
                style: TextStyle(
                    color: color, fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.job});
  final TechnicianJob job;

  @override
  Widget build(BuildContext context) {
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
            if (job.unitId != null) ...[
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

  Widget _row(IconData icon, String label, String value) {
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
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: AppColors.slate900,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DiagnosisField extends StatelessWidget {
  const _DiagnosisField({required this.controller});
  final TextEditingController controller;

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
        content: Text('$e'.replaceFirst('Exception: ', '')),
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
              error: (e, _) => Text('Gagal memuat teknisi: $e',
                  style: const TextStyle(color: AppColors.slate500)),
              data: (list) => DropdownButtonFormField<String?>(
                key: const Key('assign-technician'),
                initialValue:
                    list.any((t) => t.uid == _selected) ? _selected : null,
                decoration: const InputDecoration(labelText: 'Teknisi'),
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
class _ScanSheet extends StatefulWidget {
  const _ScanSheet({required this.expected});
  final String expected;

  @override
  State<_ScanSheet> createState() => _ScanSheetState();
}

class _ScanSheetState extends State<_ScanSheet> {
  bool _handled = false;

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
            Text('Cocokkan dengan ${widget.expected}',
                style: const TextStyle(color: AppColors.slate500)),
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
          child: TextField(
            key: const Key('job-scan-manual'),
            controller: _controller,
            decoration: const InputDecoration(
              labelText: 'Input barcode manual',
              prefixIcon: Icon(Icons.qr_code),
              isDense: true,
            ),
            onSubmitted: widget.onSubmit,
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

String _formatDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
}
