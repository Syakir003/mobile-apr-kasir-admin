import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../data/models/technician_job.dart';
import 'job_providers.dart';
import 'service_order_create_screen.dart' show IntakeJobType;

// "Ubah Detail Order" (admin): koreksi jadwal, jenis pekerjaan, note, dan titik lokasi kerja per unit yang salah
// dimasukkan saat Terima Servis (padanan edit-order-dialog.tsx di web). PATCH /service-orders/:id.

String _ymd(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)}';
}

/// Hanya field yang BERUBAH yang dikirim (catatan audit bersih). Kosong = tidak ada yang diubah.
/// [locs]/[initialLocs]: jobId -> (alamat, link). [typeEditable] false untuk pemasangan/komplain.
Map<String, dynamic> buildOrderEditPayload({
  required String? initialDate,
  required String date,
  required String initialType,
  required String type,
  required bool typeEditable,
  required String initialNote,
  required String note,
  required Map<String, (String, String)> initialLocs,
  required Map<String, (String, String)> locs,
}) {
  final changed = [
    for (final e in locs.entries)
      if (e.value.$1.trim() != (initialLocs[e.key]?.$1 ?? '').trim() ||
          e.value.$2.trim() != (initialLocs[e.key]?.$2 ?? '').trim())
        {'jobId': e.key, 'address': e.value.$1.trim(), 'mapsUrl': e.value.$2.trim()},
  ];
  return {
    if (date != initialDate) 'scheduledDate': date,
    if (typeEditable && type != initialType) 'jobType': type,
    if (note.trim() != initialNote.trim()) 'note': note.trim(),
    if (changed.isNotEmpty) 'unitLocations': changed,
  };
}

final updateServiceOrderCallerProvider =
    Provider<Future<void> Function(String orderId, Map<String, dynamic> body)>((ref) {
  return (orderId, body) async {
    await const ApiClient().patch('/service-orders/$orderId', body: body);
    ref.invalidate(jobsForCurrentUserProvider);
    ref.invalidate(ordersProvider);
  };
});

/// Tombol "Ubah Detail Order"; hilang bila semua job order sudah selesai/dibatalkan (backend juga menolak).
class EditOrderButton extends ConsumerWidget {
  const EditOrderButton({super.key, required this.jobs, this.onSaved});
  final List<TechnicianJob> jobs;

  /// Dipanggil setelah tersimpan, supaya layar pemanggil memuat ulang job yang tampil.
  final VoidCallback? onSaved;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editable =
        jobs.where((j) => j.status != JobStatus.selesai && j.status != JobStatus.dibatalkan).toList();
    if (editable.isEmpty || editable.first.orderId.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: SizedBox(
        height: 50,
        child: OutlinedButton.icon(
          key: const Key('edit-order-open'),
          onPressed: () async {
            final saved = await showModalBottomSheet<bool>(
              context: context,
              isScrollControlled: true,
              showDragHandle: true,
              builder: (_) => EditOrderSheet(jobs: editable),
            );
            if (saved == true) onSaved?.call();
          },
          icon: const Icon(Icons.edit_calendar_outlined),
          label: const Text('Ubah Detail Order'),
        ),
      ),
    );
  }
}

class EditOrderSheet extends ConsumerStatefulWidget {
  const EditOrderSheet({super.key, required this.jobs});
  final List<TechnicianJob> jobs;

  @override
  ConsumerState<EditOrderSheet> createState() => _EditOrderSheetState();
}

class _EditOrderSheetState extends ConsumerState<EditOrderSheet> {
  late final TechnicianJob _first = widget.jobs.first;
  late final String? _initialDate = _first.scheduledDate == null ? null : _ymd(_first.scheduledDate!.toLocal());
  late DateTime? _date = _first.scheduledDate?.toLocal();
  late String _type = _first.type;
  late final TextEditingController _note = TextEditingController(text: _first.orderNote ?? '');
  late final Map<String, (TextEditingController, TextEditingController)> _locs = {
    for (final j in widget.jobs)
      j.id: (TextEditingController(text: j.workAddress), TextEditingController(text: j.workMapsUrl)),
  };
  bool _busy = false;

  // Pemasangan (ditagih lewat invoice POS) dan komplain tidak boleh ganti jenis.
  bool get _typeEditable => !widget.jobs.any((j) => j.type == 'pemasangan' || j.isComplaint);

  @override
  void dispose() {
    _note.dispose();
    for (final l in _locs.values) {
      l.$1.dispose();
      l.$2.dispose();
    }
    super.dispose();
  }

  String _unitLabel(TechnicianJob j) {
    final t = j.unitTitle.isEmpty ? 'Unit AC' : j.unitTitle;
    return j.unitRoom.isEmpty ? t : '$t (${j.unitRoom})';
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 2),
    );
    if (d != null) setState(() => _date = d);
  }

  Future<void> _save() async {
    final body = buildOrderEditPayload(
      initialDate: _initialDate,
      date: _ymd(_date!),
      initialType: _first.type,
      type: _type,
      typeEditable: _typeEditable,
      initialNote: _first.orderNote ?? '',
      note: _note.text,
      initialLocs: {for (final j in widget.jobs) j.id: (j.workAddress, j.workMapsUrl)},
      locs: {for (final e in _locs.entries) e.key: (e.value.$1.text, e.value.$2.text)},
    );
    final messenger = ScaffoldMessenger.of(context);
    final nav = Navigator.of(context);
    if (body.isEmpty) {
      messenger.showSnackBar(const SnackBar(content: Text('Tidak ada yang diubah.')));
      nav.pop(false);
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(updateServiceOrderCallerProvider)(_first.orderId, body);
      messenger.showSnackBar(const SnackBar(content: Text('Data order diperbarui.')));
      nav.pop(true);
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const types = IntakeJobType.values;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Ubah Detail Order', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            const SizedBox(height: 4),
            const Text(
              'Jadwal, jenis pekerjaan, dan note berlaku untuk seluruh unit di order ini. Salah data pelanggan? '
              'Ubah di halaman Member.',
              style: TextStyle(fontSize: 12, color: AppColors.slate600),
            ),
            const SizedBox(height: 12),
            const Text('Jadwal', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            OutlinedButton.icon(
              key: const Key('edit-order-date'),
              onPressed: _busy ? null : _pickDate,
              icon: const Icon(Icons.event_outlined),
              label: Text(_date == null ? 'Pilih tanggal' : _ymd(_date!)),
            ),
            const SizedBox(height: 12),
            const Text('Jenis Pekerjaan', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            if (!_typeEditable)
              Text(
                widget.jobs.any((j) => j.isComplaint)
                    ? 'Perbaikan (komplain): jenis tidak bisa diubah.'
                    : 'Pemasangan: jenis tidak bisa diubah (ditagih lewat invoice POS).',
                style: const TextStyle(color: AppColors.slate600),
              )
            else
              DropdownButtonFormField<String>(
                key: const Key('edit-order-type'),
                initialValue: types.any((t) => t.value == _type) ? _type : types.first.value,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true),
                items: [for (final t in types) DropdownMenuItem(value: t.value, child: Text(t.label))],
                onChanged: _busy ? null : (v) => setState(() => _type = v ?? _type),
              ),
            const SizedBox(height: 12),
            const Text('Note Pekerjaan', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            TextField(
              key: const Key('edit-order-note'),
              controller: _note,
              enabled: !_busy,
              maxLines: 3,
              maxLength: 2000,
              decoration: const InputDecoration(hintText: 'Opsional - kosongkan untuk menghapus note'),
            ),
            const SizedBox(height: 4),
            const Text('Titik Lokasi Kerja per Unit', style: TextStyle(fontWeight: FontWeight.w600)),
            const Text(
              'Isi bila lokasi unit berbeda dari alamat utama pelanggan. Kosongkan alamat dan link = ikut alamat pelanggan.',
              style: TextStyle(fontSize: 12, color: AppColors.slate600),
            ),
            const SizedBox(height: 8),
            for (final j in widget.jobs)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.hairline),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_unitLabel(j), style: const TextStyle(fontWeight: FontWeight.w500)),
                    const SizedBox(height: 6),
                    TextField(
                      key: Key('edit-order-addr-${j.id}'),
                      controller: _locs[j.id]!.$1,
                      enabled: !_busy,
                      decoration: const InputDecoration(isDense: true, hintText: 'Alamat lokasi kerja (kosong = ikut pelanggan)'),
                    ),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _locs[j.id]!.$2,
                      enabled: !_busy,
                      decoration: const InputDecoration(isDense: true, hintText: 'Link Google Maps (opsional)'),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton(
                key: const Key('edit-order-save'),
                onPressed: _busy || _date == null ? null : _save,
                child: Text(_busy ? 'Menyimpan...' : 'Simpan Perubahan'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
