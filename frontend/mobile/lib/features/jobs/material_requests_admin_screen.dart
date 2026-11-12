import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/num_parse.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/material_request.dart';
import '../../data/repositories/job_repository.dart' show materialRequestRowFromNest;
import 'job_providers.dart';
import 'job_requests_section.dart' show requestStatusColor;

// Halaman admin "Permintaan Material" (padanan material-requests/page.tsx di web): semua pengajuan sparepart
// tambahan dari teknisi lintas job, difilter per status, diputuskan (setujui/revisi/tolak) tanpa membuka job satu-satu.

/// Satu baris daftar: pengajuan + konteks job/teknisi/pelanggan.
class AdminMaterialRequest {
  const AdminMaterialRequest({
    required this.request,
    required this.technicianName,
    required this.jobLabel,
    this.memberName,
  });
  final MaterialRequest request;
  final String technicianName;
  final String jobLabel;
  final String? memberName;

  factory AdminMaterialRequest.fromNest(Map<String, dynamic> r) {
    final job = (r['job'] as Map?) ?? const {};
    final unit = job['unit'] as Map?;
    final unitLabel = unit == null
        ? null
        : [unit['brand'], unit['model']].where((e) => e != null && '$e'.isNotEmpty).join(' ');
    return AdminMaterialRequest(
      request: MaterialRequest.fromMap('${r['id']}', {
        ...materialRequestRowFromNest(r),
        // Respons daftar menaruh id job di `job.id` (kolom jobId juga ada, tapi jangan bergantung padanya).
        'job_id': r['jobId'] ?? job['id'],
      }),
      technicianName: ((r['createdBy'] as Map?)?['displayName'] as String?) ?? '-',
      jobLabel: (unitLabel != null && unitLabel.isNotEmpty) ? unitLabel : ((job['type'] as String?) ?? 'Job'),
      memberName: (job['member'] as Map?)?['name'] as String?,
    );
  }
}

class AdminMaterialRequestList {
  const AdminMaterialRequestList({required this.items, required this.counts});
  final List<AdminMaterialRequest> items;
  final Map<String, int> counts; // all, pending, approved, rejected

  factory AdminMaterialRequestList.fromNest(Map<String, dynamic> j) {
    final c = (j['counts'] as Map?) ?? const {};
    return AdminMaterialRequestList(
      items: [
        for (final r in (j['items'] as List? ?? const []))
          AdminMaterialRequest.fromNest(Map<String, dynamic>.from(r as Map)),
      ],
      counts: {for (final k in const ['all', 'pending', 'approved', 'rejected']) k: numFromNest(c[k])?.toInt() ?? 0},
    );
  }
}

/// `GET /material-requests?status=` (admin). [status] 'all' = semua.
final adminMaterialRequestsProvider =
    FutureProvider.autoDispose.family<AdminMaterialRequestList, String>((ref, status) async {
  final r = await const ApiClient().get('/material-requests${status == 'all' ? '' : '?status=$status'}');
  return AdminMaterialRequestList.fromNest(Map<String, dynamic>.from(r as Map));
});

const _tabs = [
  ('all', 'Semua'),
  ('pending', 'Menunggu'),
  ('approved', 'Disetujui'),
  ('rejected', 'Ditolak'),
];

String _fmt(DateTime? d) {
  if (d == null) return '-';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
}

String _qty(num n) => n == n.roundToDouble() ? '${n.toInt()}' : '$n';

class MaterialRequestsAdminScreen extends ConsumerStatefulWidget {
  const MaterialRequestsAdminScreen({super.key});

  @override
  ConsumerState<MaterialRequestsAdminScreen> createState() => _MaterialRequestsAdminScreenState();
}

class _MaterialRequestsAdminScreenState extends ConsumerState<MaterialRequestsAdminScreen> {
  String _status = 'pending';

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(adminMaterialRequestsProvider(_status));
    // Hitungan di chip selalu dari respons terakhir yang ada (tidak berkedip saat ganti filter).
    final counts = async.asData?.value.counts;
    return Scaffold(
      appBar: AppBar(title: const Text('Permintaan Material')),
      body: Column(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Row(
              children: [
                for (final (value, label) in _tabs) ...[
                  AppFilterChip(
                    label: counts == null ? label : '$label (${counts[value] ?? 0})',
                    selected: _status == value,
                    onTap: () => setState(() => _status = value),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
          Expanded(
            child: async.when(
              loading: () => const AppSkeletonDetail(),
              error: (e, _) => AppErrorState(
                error: e,
                title: 'Gagal memuat pengajuan',
                onRetry: () => ref.invalidate(adminMaterialRequestsProvider(_status)),
              ),
              data: (data) {
                if (data.items.isEmpty) {
                  return const AppEmptyState(
                    icon: Icons.inventory_2_outlined,
                    title: 'Tidak ada pengajuan',
                    message: 'Pengajuan sparepart tambahan dari teknisi akan muncul di sini.',
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(adminMaterialRequestsProvider(_status)),
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    itemCount: data.items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) => _RequestTile(
                      item: data.items[i],
                      onTap: () => _openDetail(data.items[i]),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openDetail(AdminMaterialRequest item) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _RequestSheet(item: item),
    );
    if (changed == true) {
      for (final t in _tabs) {
        ref.invalidate(adminMaterialRequestsProvider(t.$1));
      }
    }
  }
}

class _RequestTile extends StatelessWidget {
  const _RequestTile({required this.item, required this.onTap});
  final AdminMaterialRequest item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final r = item.request;
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        key: Key('material-request-${r.id}'),
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(item.technicianName,
                        style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.slate900)),
                  ),
                  StatusBadge(label: r.status.label, color: requestStatusColor(r.status)),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                [item.jobLabel, if (item.memberName != null) item.memberName!].join(' · '),
                style: const TextStyle(fontSize: 12, color: AppColors.slate600),
              ),
              const SizedBox(height: 6),
              Text(r.items.map((e) => e.name).join(', '),
                  maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
              const SizedBox(height: 6),
              Row(
                children: [
                  Text(formatRupiah(r.total), style: const TextStyle(fontWeight: FontWeight.w600)),
                  const Spacer(),
                  Text(_fmt(r.createdAt), style: const TextStyle(fontSize: 12, color: AppColors.slate600)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RequestSheet extends ConsumerStatefulWidget {
  const _RequestSheet({required this.item});
  final AdminMaterialRequest item;

  @override
  ConsumerState<_RequestSheet> createState() => _RequestSheetState();
}

class _RequestSheetState extends ConsumerState<_RequestSheet> {
  final _note = TextEditingController();
  late final List<({MaterialRequestItem item, TextEditingController qty})> _revise = [
    for (final it in widget.item.request.items) (item: it, qty: TextEditingController(text: _qty(it.qty))),
  ];
  bool _revising = false;
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    for (final r in _revise) {
      r.qty.dispose();
    }
    super.dispose();
  }

  Future<void> _decide(String decision, {List<Map<String, dynamic>>? items}) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final nav = Navigator.of(context);
    try {
      await ref.read(decideRequestCallerProvider)({
        'requestId': widget.item.request.id,
        'decision': decision,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
        if (items != null) 'items': items,
      });
      ref.invalidate(jobsForCurrentUserProvider);
      messenger.showSnackBar(SnackBar(
        content: Text(switch (decision) {
          'reject' => 'Pengajuan ditolak.',
          'revise' => 'Pengajuan direvisi & disetujui.',
          _ => 'Pengajuan disetujui.',
        }),
      ));
      nav.pop(true);
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
      setState(() => _busy = false);
    }
  }

  void _submitRevision() {
    final items = <Map<String, dynamic>>[];
    for (final r in _revise) {
      final q = num.tryParse(r.qty.text.trim().replaceAll(',', '.')) ?? 0;
      if (q > 0) items.add({'kind': 'sparepart', 'refId': r.item.refId, 'qty': q});
    }
    if (items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Minimal 1 item dengan jumlah > 0.')));
      return;
    }
    _decide('revise', items: items);
  }

  @override
  Widget build(BuildContext context) {
    final it = widget.item;
    final r = it.request;
    Widget row(String k, String v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 90, child: Text(k, style: const TextStyle(color: AppColors.slate600, fontSize: 13))),
              Expanded(child: Text(v, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13))),
            ],
          ),
        );
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(children: [
              Expanded(
                child: Text('REQ-${r.id.substring(0, r.id.length < 8 ? r.id.length : 8).toUpperCase()}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              ),
              StatusBadge(label: r.status.label, color: requestStatusColor(r.status)),
            ]),
            const SizedBox(height: 8),
            row('Teknisi', it.technicianName),
            row('Job', it.jobLabel),
            if (it.memberName != null) row('Pelanggan', it.memberName!),
            row('Tanggal', _fmt(r.createdAt)),
            if ((r.note ?? '').isNotEmpty) row('Catatan', r.note!),
            const SizedBox(height: 8),
            Container(
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.hairline),
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  if (!_revising)
                    for (final e in r.items)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(e.name, style: const TextStyle(fontWeight: FontWeight.w500)),
                                  Text('${_qty(e.qty)} ${e.unit} × ${formatRupiah(e.unitPrice)}',
                                      style: const TextStyle(fontSize: 12, color: AppColors.slate600)),
                                ],
                              ),
                            ),
                            Text(formatRupiah(e.lineTotal), style: const TextStyle(fontWeight: FontWeight.w500)),
                          ],
                        ),
                      )
                  else ...[
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text('Ubah jumlah per item, atau kosongkan/hapus yang tidak disetujui.',
                          style: TextStyle(fontSize: 12, color: AppColors.slate600)),
                    ),
                    for (var i = 0; i < _revise.length; i++)
                      Row(
                        children: [
                          Expanded(child: Text(_revise[i].item.name, overflow: TextOverflow.ellipsis)),
                          SizedBox(
                            width: 80,
                            child: TextField(
                              key: Key('revise-qty-$i'),
                              controller: _revise[i].qty,
                              enabled: !_busy,
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: const InputDecoration(isDense: true),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Hapus item',
                            onPressed: _busy ? null : () => setState(() => _revise[i].qty.text = '0'),
                            icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                          ),
                        ],
                      ),
                  ],
                  const Divider(),
                  Row(children: [
                    const Expanded(child: Text('Total', style: TextStyle(fontWeight: FontWeight.w700))),
                    Text(formatRupiah(r.total), style: const TextStyle(fontWeight: FontWeight.w700)),
                  ]),
                ],
              ),
            ),
            if (!r.isPending) ...[
              const SizedBox(height: 8),
              if ((r.decisionNote ?? '').isNotEmpty) row('Keputusan', r.decisionNote!),
              if (r.isApproved)
                row('Pemakaian', r.isUsed ? 'Sudah dipakai - ${_fmt(r.usedAt)}' : 'Belum ditandai dipakai teknisi'),
              if (r.isApproved && r.isUsed) ...[
                for (final e in r.items)
                  row(e.name, '${_qty(e.qtyUsed ?? e.qty)} dari ${_qty(e.qty)} ${e.unit}'),
                if ((r.usedNote ?? '').isNotEmpty) row('Catatan teknisi', r.usedNote!),
              ],
            ],
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: const Key('request-open-job'),
                onPressed: () {
                  Navigator.of(context).pop();
                  context.push('/jobs/${r.jobId}');
                },
                icon: const Icon(Icons.open_in_new, size: 16),
                label: const Text('Buka halaman job'),
              ),
            ),
            if (r.isPending) ...[
              TextField(
                controller: _note,
                enabled: !_busy,
                maxLines: 2,
                decoration: const InputDecoration(hintText: 'Catatan keputusan (opsional)'),
              ),
              const SizedBox(height: 10),
              if (!_revising)
                Row(children: [
                  Expanded(
                    child: OutlinedButton(
                      key: const Key('request-reject'),
                      onPressed: _busy ? null : () => _decide('reject'),
                      style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
                      child: const Text('Tolak'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      key: const Key('request-revise'),
                      onPressed: _busy ? null : () => setState(() => _revising = true),
                      child: const Text('Revisi'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      key: const Key('request-approve'),
                      onPressed: _busy ? null : () => _decide('approve'),
                      child: Text(_busy ? '...' : 'Setujui'),
                    ),
                  ),
                ])
              else
                Row(children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy ? null : () => setState(() => _revising = false),
                      child: const Text('Batal'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: FilledButton(
                      key: const Key('request-save-revision'),
                      onPressed: _busy ? null : _submitRevision,
                      child: Text(_busy ? 'Menyimpan...' : 'Simpan Revisi & Setujui'),
                    ),
                  ),
                ]),
            ],
          ],
        ),
      ),
    );
  }
}
