import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/status_badge.dart';
import '../../core/utils/error_message.dart';
import '../../data/models/app_user.dart';
import '../../data/models/material_request.dart';
import '../../data/models/technician_job.dart';
import '../master/master_providers.dart';
import '../pos/cart_state.dart' show formatRupiah;
import 'job_providers.dart';
import '../../core/widgets/form_field.dart';

/// Warna badge status pengajuan.
Color requestStatusColor(RequestStatus s) => switch (s) {
      RequestStatus.pending => AppColors.warning,
      RequestStatus.approved => AppColors.success,
      RequestStatus.rejected => AppColors.danger,
    };

/// Kartu "Pengajuan Tambahan" di detail job: teknisi pemilik mengajukan
/// sparepart/produk saat job aktif; admin/kasir menyetujui/menolak yang pending.
class JobRequestsSection extends ConsumerWidget {
  const JobRequestsSection({super.key, required this.job});

  final TechnicianJob job;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).value;
    final role = user?.role;
    final canSubmit = role == UserRole.teknisi &&
        job.technicianId == user?.uid &&
        (job.status == JobStatus.assigned ||
            job.status == JobStatus.sedangDikerjakan);
    final canDecide = role == UserRole.admin || role == UserRole.kasir;
    // Menandai material dipakai: teknisi pemilik job atau admin (kasir tidak).
    final canUse = role == UserRole.admin ||
        (role == UserRole.teknisi && job.technicianId == user?.uid);
    final requestsAsync = ref.watch(jobRequestsProvider(job.id));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text('Pengajuan Tambahan',
                    style: TextStyle(
                        fontWeight: FontWeight.w600, color: AppColors.slate900)),
                const Spacer(),
                if (canSubmit)
                  TextButton.icon(
                    onPressed: () => _openSubmit(context, ref),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Ajukan'),
                    style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8)),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            requestsAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: LinearProgressIndicator(),
              ),
              error: (e, _) => Text('Gagal memuat pengajuan: ${errorMessage(e)}',
                  style: const TextStyle(color: AppColors.slate500)),
              data: (requests) {
                if (requests.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: 6),
                    child: Text('Belum ada pengajuan.',
                        style: TextStyle(color: AppColors.slate500)),
                  );
                }
                return Column(
                  children: [
                    for (final r in requests)
                      _RequestCard(
                        request: r,
                        jobId: job.id,
                        canDecide: canDecide,
                        canUse: canUse,
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

  Future<void> _openSubmit(BuildContext context, WidgetRef ref) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (_) => _SubmitRequestSheet(jobId: job.id),
    );
  }
}

class _RequestCard extends ConsumerStatefulWidget {
  const _RequestCard({
    required this.request,
    required this.jobId,
    required this.canDecide,
    required this.canUse,
  });

  final MaterialRequest request;
  final String jobId;
  final bool canDecide;
  final bool canUse;

  @override
  ConsumerState<_RequestCard> createState() => _RequestCardState();
}

class _RequestCardState extends ConsumerState<_RequestCard> {
  bool _busy = false;

  Future<void> _decide(String decision,
      {String? note, List<Map<String, dynamic>>? items}) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(decideRequestCallerProvider)({
        'requestId': widget.request.id,
        'decision': decision,
        if (note != null) 'note': note,
        if (items != null) 'items': items,
      });
      ref.invalidate(jobRequestsProvider(widget.jobId));
      // Total invoice bisa berubah → segarkan detail job juga.
      ref.invalidate(jobProvider(widget.jobId));
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(switch (decision) {
          'approve' => 'Pengajuan disetujui.',
          'revise' => 'Pengajuan disetujui dengan revisi.',
          _ => 'Pengajuan ditolak.',
        }),
      ));
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

  /// Buka dialog revisi qty tiap item lalu setujui dengan nilai revisi.
  Future<void> _reviseThenApprove() async {
    final result = await showDialog<List<Map<String, dynamic>>>(
      context: context,
      builder: (_) => _ReviseDialog(request: widget.request),
    );
    if (result == null) return; // dibatalkan
    await _decide('revise', items: result);
  }

  Future<void> _markUsed() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(markMaterialUsedCallerProvider)({
        'requestId': widget.request.id,
      });
      ref.invalidate(jobRequestsProvider(widget.jobId));
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Material ditandai dipakai — stok dipotong.')),
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

  Future<void> _rejectWithNote() async {
    final controller = TextEditingController();
    final note = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Tolak Pengajuan'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(hintText: 'Alasan (opsional)'),
          autofocus: true,
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Batal')),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            child: const Text('Tolak'),
          ),
        ],
      ),
    );
    if (note == null) return; // dibatalkan
    await _decide('reject', note: note.isEmpty ? null : note);
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.request;
    final color = requestStatusColor(r.status);
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(formatRupiah(r.total),
                    style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: AppColors.slate900,
                        fontSize: 15)),
              ),
              StatusBadge(label: r.status.label, color: color),
            ],
          ),
          const SizedBox(height: 8),
          for (final it in r.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                '• ${it.name} — ${it.qty}${it.unit.isEmpty ? '' : ' ${it.unit}'} × ${formatRupiah(it.unitPrice)}',
                style: const TextStyle(color: AppColors.slate600, fontSize: 13),
              ),
            ),
          if (r.note != null && r.note!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('Catatan: ${r.note}',
                style: const TextStyle(
                    color: AppColors.slate500,
                    fontSize: 12,
                    fontStyle: FontStyle.italic)),
          ],
          if (r.decisionNote != null && r.decisionNote!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('Keputusan: ${r.decisionNote}',
                style: const TextStyle(
                    color: AppColors.slate500,
                    fontSize: 12,
                    fontStyle: FontStyle.italic)),
          ],
          if (r.isUsed) ...[
            const SizedBox(height: 8),
            const Row(
              children: [
                Icon(Icons.inventory_2_outlined,
                    size: 16, color: AppColors.success),
                SizedBox(width: 6),
                Text('Material sudah dipakai (stok dipotong)',
                    style: TextStyle(
                        color: AppColors.success,
                        fontSize: 12,
                        fontWeight: FontWeight.w600)),
              ],
            ),
          ],
          if (widget.canDecide && r.isPending) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : _rejectWithNote,
                    style: AppButtonStyles.destructive(),
                    child: const Text('Tolak'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : _reviseThenApprove,
                    child: const Text('Revisi'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: _busy ? null : () => _decide('approve'),
                    child: _busy
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : const Text('Setujui'),
                  ),
                ),
              ],
            ),
          ],
          // Disetujui tapi belum dipakai → teknisi/admin tandai dipakai
          // (baru di sini stok dipotong; rule 8.4e).
          if (widget.canUse && r.needsUsage) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _busy ? null : _markUsed,
                icon: _busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.inventory_2_outlined, size: 18),
                label: const Text('Gunakan Material'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Dialog revisi: ubah qty tiap item (0 = hapus). Kembalikan [{itemId, qty}].
class _ReviseDialog extends StatefulWidget {
  const _ReviseDialog({required this.request});
  final MaterialRequest request;

  @override
  State<_ReviseDialog> createState() => _ReviseDialogState();
}

class _ReviseDialogState extends State<_ReviseDialog> {
  late final Map<String, num> _qty = {
    for (final it in widget.request.items) it.id: it.qty,
  };

  int get _total {
    var sum = 0;
    for (final it in widget.request.items) {
      sum += ((_qty[it.id] ?? 0) * it.unitPrice).round();
    }
    return sum;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Revisi Pengajuan'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Sesuaikan jumlah (0 = hapus item).',
                style: TextStyle(color: AppColors.slate500, fontSize: 13)),
            const SizedBox(height: 8),
            for (final it in widget.request.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(it.name,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.slate900)),
                          Text(formatRupiah(it.unitPrice),
                              style: const TextStyle(
                                  color: AppColors.slate500, fontSize: 12)),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => setState(() {
                        final q = (_qty[it.id] ?? 0);
                        if (q > 0) _qty[it.id] = q - 1;
                      }),
                      icon: const Icon(Icons.remove_circle_outline),
                      color: AppColors.slate500,
                    ),
                    Text('${_qty[it.id] ?? 0}',
                        style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            color: AppColors.slate900)),
                    IconButton(
                      onPressed: () =>
                          setState(() => _qty[it.id] = (_qty[it.id] ?? 0) + 1),
                      icon: const Icon(Icons.add_circle_outline),
                      color: AppColors.teal600,
                    ),
                  ],
                ),
              ),
            const Divider(),
            Row(
              children: [
                const Text('Total revisi',
                    style: TextStyle(color: AppColors.slate500)),
                const Spacer(),
                Text(formatRupiah(_total),
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, color: AppColors.slate900)),
              ],
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Batal')),
        FilledButton(
          onPressed: _total <= 0
              ? null
              : () => Navigator.of(context).pop([
                    for (final e in _qty.entries)
                      {'itemId': e.key, 'qty': e.value},
                  ]),
          child: const Text('Setujui Revisi'),
        ),
      ],
    );
  }
}

/// Item terpilih untuk draft pengajuan.
class _DraftLine {
  _DraftLine({
    required this.kind,
    required this.refId,
    required this.name,
    required this.unit,
    required this.price,
  });

  final String kind;
  final String refId;
  final String name;
  final String unit;
  final int price;
  num qty = 1;
}

/// Sheet form pengajuan: tambah beberapa item + qty, lalu kirim.
class _SubmitRequestSheet extends ConsumerStatefulWidget {
  const _SubmitRequestSheet({required this.jobId});

  final String jobId;

  @override
  ConsumerState<_SubmitRequestSheet> createState() =>
      _SubmitRequestSheetState();
}

class _SubmitRequestSheetState extends ConsumerState<_SubmitRequestSheet> {
  final _lines = <_DraftLine>[];
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  int get _total =>
      _lines.fold(0, (sum, l) => sum + (l.qty * l.price).round());

  Future<void> _addItem() async {
    final picked = await showModalBottomSheet<_DraftLine>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (_) => const _ItemPickerSheet(),
    );
    if (picked == null) return;
    setState(() {
      final existing = _lines.indexWhere(
          (l) => l.kind == picked.kind && l.refId == picked.refId);
      if (existing >= 0) {
        _lines[existing].qty += 1;
      } else {
        _lines.add(picked);
      }
    });
  }

  Future<void> _submit() async {
    if (_lines.isEmpty) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await ref.read(submitRequestCallerProvider)({
        'jobId': widget.jobId,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
        'items': [
          for (final l in _lines)
            {'kind': l.kind, 'refId': l.refId, 'qty': l.qty},
        ],
      });
      ref.invalidate(jobRequestsProvider(widget.jobId));
      navigator.pop();
      messenger.showSnackBar(
        const SnackBar(content: Text('Pengajuan terkirim.')),
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
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 14, 20, 20 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.slate300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 14),
          const Text('Ajukan Tambahan',
              style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                  color: AppColors.slate900)),
          const SizedBox(height: 12),
          if (_lines.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text('Belum ada item. Tekan "Tambah Item".',
                  style: TextStyle(color: AppColors.slate500)),
            ),
          for (var i = 0; i < _lines.length; i++) _lineTile(i),
          const SizedBox(height: 6),
          OutlinedButton.icon(
            onPressed: _busy ? null : _addItem,
            icon: const Icon(Icons.add),
            label: const Text('Tambah Item'),
          ),
          const SizedBox(height: 12),
          AppTextField(
            label: 'Catatan',
            hint: 'Alasan tambahan…',
            controller: _note,
            enabled: !_busy,
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              const Text('Total',
                  style: TextStyle(color: AppColors.slate500)),
              const Spacer(),
              Text(formatRupiah(_total),
                  style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: AppColors.slate900)),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 50,
            width: double.infinity,
            child: FilledButton(
              onPressed: (_busy || _lines.isEmpty) ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Text('Kirim Pengajuan'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _lineTile(int i) {
    final l = _lines[i];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.name,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        color: AppColors.slate900)),
                Text(formatRupiah(l.price),
                    style: const TextStyle(
                        color: AppColors.slate500, fontSize: 12)),
              ],
            ),
          ),
          IconButton(
            onPressed: () => setState(() {
              if (l.qty > 1) {
                l.qty -= 1;
              } else {
                _lines.removeAt(i);
              }
            }),
            icon: const Icon(Icons.remove_circle_outline),
            color: AppColors.slate500,
          ),
          Text('${l.qty}',
              style: const TextStyle(
                  fontWeight: FontWeight.w600, color: AppColors.slate900)),
          IconButton(
            onPressed: () => setState(() => l.qty += 1),
            icon: const Icon(Icons.add_circle_outline),
            color: AppColors.teal600,
          ),
        ],
      ),
    );
  }
}

/// Pemilih item (sparepart + produk) untuk pengajuan; kembalikan [_DraftLine].
class _ItemPickerSheet extends ConsumerStatefulWidget {
  const _ItemPickerSheet();

  @override
  ConsumerState<_ItemPickerSheet> createState() => _ItemPickerSheetState();
}

class _ItemPickerSheetState extends ConsumerState<_ItemPickerSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final spareparts = ref.watch(sparepartListProvider);
    final products = ref.watch(productListProvider);
    final q = _query.trim().toLowerCase();

    final lines = <_DraftLine>[];
    for (final s in spareparts.value ?? const []) {
      if (!s.active) continue;
      lines.add(_DraftLine(
        kind: 'sparepart',
        refId: s.id,
        name: s.name,
        unit: s.unit,
        price: s.sellPrice,
      ));
    }
    for (final p in products.value ?? const []) {
      if (!p.active) continue;
      lines.add(_DraftLine(
        kind: 'product',
        refId: p.id,
        name: p.name,
        unit: 'unit',
        price: p.sellPrice,
      ));
    }
    final filtered = q.isEmpty
        ? lines
        : lines.where((l) => l.name.toLowerCase().contains(q)).toList();

    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 14, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Pilih Item',
              style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: AppColors.slate900)),
          const SizedBox(height: 10),
          TextField(
            decoration: const InputDecoration(
              hintText: 'Cari sparepart/produk…',
              prefixIcon: Icon(Icons.search),
              isDense: true,
            ),
            onChanged: (v) => setState(() => _query = v),
          ),
          const SizedBox(height: 8),
          Flexible(
            child: filtered.isEmpty
                ? const Padding(
                    padding: EdgeInsets.all(20),
                    child: Text('Tidak ada item.',
                        style: TextStyle(color: AppColors.slate500)),
                  )
                : ListView.separated(
                    shrinkWrap: true,
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final l = filtered[i];
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(l.name),
                        subtitle: Text(
                            '${l.kind == 'product' ? 'Produk' : 'Sparepart'} · ${formatRupiah(l.price)}'),
                        onTap: () => Navigator.of(context).pop(l),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
