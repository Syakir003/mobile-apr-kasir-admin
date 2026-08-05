import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import 'audit_providers.dart';

/// Kelompok aksi → warna, supaya jenis aktivitas terbaca sekilas.
Color auditActionColor(String action) {
  final group = action.split('.').first;
  return switch (group) {
    'pos' => AppColors.teal700,
    'job' => AppColors.blue600,
    'request' => AppColors.warning,
    'stock' => AppColors.indigo600,
    'user' => AppColors.orange600,
    'order' => AppColors.green600,
    _ => AppColors.slate500,
  };
}

/// Riwayat audit (admin). Menampilkan 200 aktivitas terakhir dari
/// `audit_logs`, dengan detail JSON yang bisa dibuka per baris.
class AuditLogScreen extends ConsumerStatefulWidget {
  const AuditLogScreen({super.key});

  @override
  ConsumerState<AuditLogScreen> createState() => _AuditLogScreenState();
}

class _AuditLogScreenState extends ConsumerState<AuditLogScreen> {
  /// null = semua. Berisi prefix grup aksi ('pos', 'job', …).
  String? _filter;

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(auditLogsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Riwayat Aktivitas'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(auditLogsProvider),
          ),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('Gagal memuat riwayat: $e',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.slate500)),
          ),
        ),
        data: (entries) {
          final groups = <String>{
            for (final e in entries) e.action.split('.').first,
          }.toList()
            ..sort();
          final shown = _filter == null
              ? entries
              : entries.where((e) => e.action.startsWith('$_filter.')).toList();

          return Column(
            children: [
              if (groups.length > 1)
                SizedBox(
                  height: 52,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    children: [
                      _Chip(
                        label: 'Semua',
                        selected: _filter == null,
                        onTap: () => setState(() => _filter = null),
                      ),
                      for (final g in groups)
                        _Chip(
                          label: _groupLabel(g),
                          selected: _filter == g,
                          onTap: () => setState(() => _filter = g),
                        ),
                    ],
                  ),
                ),
              Expanded(
                child: shown.isEmpty
                    ? const Center(
                        child: Text('Belum ada aktivitas tercatat.',
                            style: TextStyle(color: AppColors.slate500)),
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                        itemCount: shown.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _EntryTile(entry: shown[i]),
                      ),
              ),
            ],
          );
        },
      ),
    );
  }
}

String _groupLabel(String group) => switch (group) {
      'pos' => 'Transaksi',
      'job' => 'Job',
      'request' => 'Pengajuan',
      'stock' => 'Stok',
      'user' => 'Akun',
      'order' => 'Order',
      _ => group,
    };

class _EntryTile extends StatelessWidget {
  const _EntryTile({required this.entry});
  final AuditEntry entry;

  @override
  Widget build(BuildContext context) {
    final color = auditActionColor(entry.action);
    final details = entry.detail.entries
        .where((e) => e.value != null && '${e.value}'.isNotEmpty)
        .toList();

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Theme(
        // Hilangkan garis pemisah bawaan ExpansionTile agar sejalan dengan
        // kartu-kartu lain di aplikasi.
        data: Theme.of(context)
            .copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 14),
          childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
          leading: Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(_iconFor(entry.action), size: 18, color: color),
          ),
          title: Text(entry.label,
              style: const TextStyle(
                  fontWeight: FontWeight.w600, color: AppColors.slate900)),
          subtitle: Text(
            [
              if (entry.actorName.isNotEmpty) entry.actorName else 'Sistem',
              if (entry.at != null) _fmt(entry.at!),
            ].join(' • '),
            style: const TextStyle(fontSize: 12, color: AppColors.slate500),
          ),
          children: [
            if (entry.target.isNotEmpty)
              _DetailRow(label: 'Target', value: entry.target),
            for (final d in details)
              _DetailRow(label: d.key, value: '${d.value}'),
            if (entry.target.isEmpty && details.isEmpty)
              const Align(
                alignment: Alignment.centerLeft,
                child: Text('Tanpa detail tambahan.',
                    style: TextStyle(color: AppColors.slate500, fontSize: 12)),
              ),
          ],
        ),
      ),
    );
  }
}

IconData _iconFor(String action) => switch (action.split('.').first) {
      'pos' => Icons.receipt_long_outlined,
      'job' => Icons.handyman_outlined,
      'request' => Icons.assignment_turned_in_outlined,
      'stock' => Icons.inventory_outlined,
      'user' => Icons.person_outline,
      'order' => Icons.assignment_outlined,
      _ => Icons.history,
    };

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label,
                style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.slate500)),
          ),
          Expanded(
            child: SelectableText(value,
                style: const TextStyle(
                    fontSize: 12, color: AppColors.slate700)),
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8, top: 10, bottom: 10),
      child: Material(
        color: selected ? AppColors.teal600 : Colors.white,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                  color: selected ? AppColors.teal600 : AppColors.slate200),
            ),
            child: Text(label,
                style: TextStyle(
                    color: selected ? Colors.white : AppColors.slate600,
                    fontWeight: FontWeight.w600,
                    fontSize: 13)),
          ),
        ),
      ),
    );
  }
}

String _fmt(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
}
