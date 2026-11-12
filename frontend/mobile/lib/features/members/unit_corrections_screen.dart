import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';

// Koreksi data unit AC usulan teknisi (admin): setujui = data unit diganti, tolak = wajib beri alasan
// (padanan tab Koreksi pada Input Data Lampau di web). GET /unit-corrections, POST .../approve|reject.

/// Satu baris perbedaan: label, nilai lama, nilai usulan.
typedef DiffRow = ({String label, String oldValue, String newValue});

class UnitCorrection {
  UnitCorrection(Map<String, dynamic> j)
      : id = '${j['id']}',
        status = '${j['status']}',
        requestedBy = ((j['requestedBy'] as Map?)?['displayName'] as String?) ?? '-',
        reviewedBy = (j['reviewedBy'] as Map?)?['displayName'] as String?,
        note = j['note'] as String?,
        reviewNote = j['reviewNote'] as String?,
        createdAt = DateTime.tryParse('${j['createdAt']}')?.toLocal(),
        memberName = (((j['unit'] as Map?)?['member']) as Map?)?['name'] as String? ?? '-',
        barcode = ((j['unit'] as Map?)?['barcodeValue'] as String?) ?? '',
        diff = diffRows(j);
  final String id;
  final String status; // pending | approved | rejected
  final String requestedBy;
  final String? reviewedBy;
  final String? note;
  final String? reviewNote;
  final DateTime? createdAt;
  final String memberName;
  final String barcode;
  final List<DiffRow> diff;
}

/// Hanya field yang diusulkan (non-null) yang tampil, bersama nilai lamanya di unit.
List<DiffRow> diffRows(Map<String, dynamic> c) {
  final unit = (c['unit'] as Map?) ?? const {};
  String fmt(Object? v) {
    if (v == null) return '-';
    final s = '$v';
    if (s.isEmpty) return '-';
    final n = num.tryParse(s);
    if (n != null && s.contains('.')) return n == n.roundToDouble() ? '${n.toInt()}' : '$n';
    return s.length >= 10 && RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(s)
        ? s.substring(0, 10).split('-').reversed.join('-')
        : s;
  }

  const fields = [
    ('Merk', 'brand'),
    ('Model', 'model'),
    ('PK', 'pk'),
    ('Ruangan', 'roomLocation'),
    ('No. seri', 'serialNumber'),
    ('Tgl pasang', 'installationDate'),
  ];
  return [
    for (final (label, key) in fields)
      if (c[key] != null) (label: label, oldValue: fmt(unit[key]), newValue: fmt(c[key])),
  ];
}

final unitCorrectionsProvider = FutureProvider.autoDispose.family<List<UnitCorrection>, String>((ref, status) async {
  final r = await const ApiClient().get('/unit-corrections?status=$status&pageSize=50') as Map;
  return [
    for (final e in (r['items'] as List? ?? const [])) UnitCorrection(Map<String, dynamic>.from(e as Map)),
  ];
});

/// `POST /unit-corrections/:id/approve` atau `/reject` (alasan wajib untuk tolak).
final reviewCorrectionCallerProvider =
    Provider<Future<void> Function(String id, {required bool approve, String? reason})>((ref) {
  return (id, {required approve, reason}) async {
    await const ApiClient().post(
      '/unit-corrections/$id/${approve ? 'approve' : 'reject'}',
      body: approve ? <String, dynamic>{} : {'reviewNote': reason},
    );
    for (final s in const ['pending', 'approved', 'rejected']) {
      ref.invalidate(unitCorrectionsProvider(s));
    }
  };
});

const _statusLabel = {'pending': 'Menunggu', 'approved': 'Disetujui', 'rejected': 'Ditolak'};

class UnitCorrectionsScreen extends ConsumerStatefulWidget {
  const UnitCorrectionsScreen({super.key});

  @override
  ConsumerState<UnitCorrectionsScreen> createState() => _UnitCorrectionsScreenState();
}

class _UnitCorrectionsScreenState extends ConsumerState<UnitCorrectionsScreen> {
  String _status = 'pending';

  String _fmt(DateTime? d) {
    if (d == null) return '-';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
  }

  Future<void> _approve(UnitCorrection c) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(reviewCorrectionCallerProvider)(c.id, approve: true);
      messenger.showSnackBar(const SnackBar(content: Text('Disetujui - data unit sudah berganti.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    }
  }

  Future<void> _reject(UnitCorrection c) async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          title: const Text('Tolak koreksi'),
          content: TextField(
            key: const Key('reject-reason'),
            controller: reason,
            maxLines: 3,
            onChanged: (_) => setS(() {}),
            decoration: const InputDecoration(hintText: 'Alasan penolakan wajib diisi supaya teknisi tahu'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Batal')),
            FilledButton(
              key: const Key('reject-confirm'),
              onPressed: reason.text.trim().isEmpty ? null : () => Navigator.of(ctx).pop(true),
              child: const Text('Tolak'),
            ),
          ],
        ),
      ),
    );
    // Controller lokal tanpa listener: tidak di-dispose di sini karena dialog masih animasi menutup.
    final text = reason.text.trim();
    if (ok != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(reviewCorrectionCallerProvider)(c.id, approve: false, reason: text);
      messenger.showSnackBar(const SnackBar(content: Text('Koreksi ditolak.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(unitCorrectionsProvider(_status));
    return Scaffold(
      appBar: AppBar(title: const Text('Koreksi Data Unit')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(children: [
              for (final e in _statusLabel.entries) ...[
                AppFilterChip(label: e.value, selected: _status == e.key, onTap: () => setState(() => _status = e.key)),
                const SizedBox(width: 8),
              ],
            ]),
          ),
          Expanded(
            child: async.when(
              loading: () => const AppSkeletonList(),
              error: (e, _) => AppErrorState(
                error: e,
                title: 'Gagal memuat koreksi',
                onRetry: () => ref.invalidate(unitCorrectionsProvider(_status)),
              ),
              data: (list) => list.isEmpty
                  ? const AppEmptyState(icon: Icons.fact_check_outlined, title: 'Tidak ada koreksi')
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      itemCount: list.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, i) => _tile(list[i]),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _tile(UnitCorrection c) {
    final color = switch (c.status) {
      'approved' => AppColors.success,
      'rejected' => AppColors.slate600,
      _ => AppColors.warning,
    };
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text(c.memberName, style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              StatusBadge(label: _statusLabel[c.status] ?? c.status, color: color),
            ]),
            if (c.barcode.isNotEmpty)
              Text(c.barcode, style: const TextStyle(fontSize: 12, color: AppColors.slate600, fontFamily: 'monospace')),
            Text('Diajukan ${c.requestedBy} · ${_fmt(c.createdAt)}',
                style: const TextStyle(fontSize: 12, color: AppColors.slate600)),
            const SizedBox(height: 8),
            for (final r in c.diff)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(children: [
                  SizedBox(width: 76, child: Text(r.label, style: const TextStyle(color: AppColors.slate600, fontSize: 13))),
                  Expanded(
                    child: Text(r.oldValue,
                        style: const TextStyle(decoration: TextDecoration.lineThrough, fontSize: 13, color: AppColors.slate600)),
                  ),
                  Expanded(child: Text(r.newValue, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
                ]),
              ),
            if ((c.note ?? '').isNotEmpty) ...[
              const SizedBox(height: 6),
              Text('Catatan teknisi: ${c.note}', style: const TextStyle(fontSize: 13)),
            ],
            if (c.status != 'pending') ...[
              const SizedBox(height: 6),
              Text(
                '${_statusLabel[c.status]} oleh ${c.reviewedBy ?? '-'}${(c.reviewNote ?? '').isNotEmpty ? ' - ${c.reviewNote}' : ''}',
                style: const TextStyle(fontSize: 12, color: AppColors.slate600),
              ),
            ] else ...[
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: FilledButton(
                    key: Key('approve-${c.id}'),
                    onPressed: () => _approve(c),
                    child: const Text('Setujui & ganti data'),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  key: Key('reject-${c.id}'),
                  onPressed: () => _reject(c),
                  child: const Text('Tolak'),
                ),
              ]),
            ],
          ],
        ),
      ),
    );
  }
}
