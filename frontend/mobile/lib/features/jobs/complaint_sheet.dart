import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../data/models/technician_job.dart';
import 'job_providers.dart';
import 'technician_multi_picker.dart';

// Komplain pelanggan (admin): dari job yang sudah SELESAI, buat job pengerjaan ulang tanpa mengisi ulang data
// (padanan complaint-dialog.tsx di web). Tanpa harga jasa atau tagihan baru; job awal tidak berubah.

/// Muatan `POST /technician-jobs/:id/complaint`. [technicianIds] kosong = belum ditentukan (admin menugaskan belakangan).
Map<String, dynamic> buildComplaintPayload({
  required List<String> jobIds,
  required String complaint,
  required DateTime scheduled,
  required List<String> technicianIds,
}) {
  String two(int n) => n.toString().padLeft(2, '0');
  return {
    'jobIds': jobIds,
    'complaint': complaint.trim(),
    'technicianIds': technicianIds,
    'scheduledDate': '${scheduled.year}-${two(scheduled.month)}-${two(scheduled.day)}',
  };
}

/// Hasil: id job komplain pertama, atau null bila diurungkan.
final createComplaintCallerProvider =
    Provider<Future<String?> Function(String anchorJobId, Map<String, dynamic> body)>((ref) {
  return (anchor, body) async {
    final r = await const ApiClient().post('/technician-jobs/$anchor/complaint', body: body);
    ref.invalidate(jobsForCurrentUserProvider);
    return r is Map ? r['jobId'] as String? : null;
  };
});

/// Tombol "Komplain" + lembarnya. Hilang bila belum ada job selesai di order ini.
class ComplaintButton extends ConsumerWidget {
  const ComplaintButton({super.key, required this.anchorJobId, required this.jobs, this.onCreated});
  final String anchorJobId;
  final List<TechnicianJob> jobs;

  /// Dipanggil dengan id job komplain yang baru (mis. untuk membukanya).
  final ValueChanged<String>? onCreated;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final finished = jobs.where((j) => j.status == JobStatus.selesai).toList();
    if (finished.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: SizedBox(
        height: 50,
        child: OutlinedButton.icon(
          key: const Key('complaint-open'),
          style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
          onPressed: () async {
            final id = await showModalBottomSheet<String>(
              context: context,
              isScrollControlled: true,
              showDragHandle: true,
              builder: (_) => ComplaintSheet(anchorJobId: anchorJobId, finished: finished),
            );
            if (id != null) onCreated?.call(id);
          },
          icon: const Icon(Icons.report_problem_outlined),
          label: const Text('Komplain'),
        ),
      ),
    );
  }
}

class ComplaintSheet extends ConsumerStatefulWidget {
  const ComplaintSheet({super.key, required this.anchorJobId, required this.finished});
  final String anchorJobId;
  final List<TechnicianJob> finished;

  @override
  ConsumerState<ComplaintSheet> createState() => _ComplaintSheetState();
}

class _ComplaintSheetState extends ConsumerState<ComplaintSheet> {
  final _complaint = TextEditingController();
  late final Set<String> _picked = widget.finished.length == 1 ? {widget.finished.first.id} : {};
  // Teknisi bawaan = teknisi pekerjaan awal, seperti yang dilakukan backend.
  late List<String> _technicianIds = List.of(widget.finished.first.technicianIds);
  DateTime _date = DateTime.now();
  bool _busy = false;

  @override
  void dispose() {
    _complaint.dispose();
    super.dispose();
  }

  bool get _canSubmit => !_busy && _picked.isNotEmpty && _complaint.text.trim().isNotEmpty;

  String _unitLabel(TechnicianJob j) {
    final t = j.unitTitle.isEmpty ? 'Unit AC' : j.unitTitle;
    return j.unitRoom.isEmpty ? t : '$t (${j.unitRoom})';
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 2),
    );
    if (d != null) setState(() => _date = d);
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final nav = Navigator.of(context);
    try {
      final id = await ref.read(createComplaintCallerProvider)(
        widget.anchorJobId,
        buildComplaintPayload(
          jobIds: _picked.toList(),
          complaint: _complaint.text,
          scheduled: _date,
          technicianIds: _technicianIds,
        ),
      );
      messenger.showSnackBar(SnackBar(
        content: Text(_picked.length > 1 ? 'Job komplain dibuat untuk ${_picked.length} unit.' : 'Job komplain dibuat.'),
      ));
      nav.pop(id ?? widget.anchorJobId);
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    String two(int n) => n.toString().padLeft(2, '0');
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Komplain Pelanggan', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            const SizedBox(height: 4),
            const Text(
              'Membuat job baru dari pekerjaan yang sudah selesai, tanpa mengisi ulang data. Hasil pekerjaan awal '
              '(temuan, foto, tagihan) tidak diubah. Teknisi tetap scan unit dulu, dan tidak ada harga jasa atau tagihan baru.',
              style: TextStyle(fontSize: 12, color: AppColors.slate600),
            ),
            const SizedBox(height: 12),
            if (widget.finished.length > 1) ...[
              const Text('Unit yang dikomplain', style: TextStyle(fontWeight: FontWeight.w600)),
              for (final j in widget.finished)
                CheckboxListTile(
                  key: Key('complaint-unit-${j.id}'),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _picked.contains(j.id),
                  title: Text(_unitLabel(j)),
                  onChanged: _busy
                      ? null
                      : (v) => setState(() => v == true ? _picked.add(j.id) : _picked.remove(j.id)),
                ),
              const SizedBox(height: 8),
            ],
            const Text('Keluhan', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            TextField(
              key: const Key('complaint-text'),
              controller: _complaint,
              enabled: !_busy,
              maxLines: 3,
              maxLength: 500,
              decoration: const InputDecoration(hintText: 'Mis. AC masih bocor setelah dicuci'),
              onChanged: (_) => setState(() {}),
            ),
            const Text('Jadwal pengerjaan ulang', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            OutlinedButton.icon(
              key: const Key('complaint-date'),
              onPressed: _busy ? null : _pickDate,
              icon: const Icon(Icons.event_outlined),
              label: Text('${two(_date.day)}-${two(_date.month)}-${_date.year}'),
            ),
            const SizedBox(height: 12),
            const Text('Teknisi (opsional)', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            TechnicianMultiPicker(
              value: _technicianIds,
              enabled: !_busy,
              onChanged: (v) => setState(() => _technicianIds = v),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton(
                key: const Key('complaint-submit'),
                style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
                onPressed: _canSubmit ? _submit : null,
                child: Text(_busy ? 'Memproses...' : 'Buat Job Komplain'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
