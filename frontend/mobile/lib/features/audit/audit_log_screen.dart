import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_filter_chip.dart';
import 'audit_providers.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';

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

/// Semua grup aksi yang dikenal. Dipakai sebagai daftar chip TETAP — dulu
/// daftarnya diturunkan dari data yang sedang tampil, yang membuat chip
/// menghilang begitu filternya dipakai (sekali memilih "Stok", satu-satunya
/// chip tersisa adalah "Stok" dan pengguna terjebak di sana).
const _auditGroups = ['pos', 'order', 'job', 'request', 'stock', 'user'];

/// Riwayat audit (admin) — siapa melakukan apa, kapan, dengan detail apa.
class AuditLogScreen extends ConsumerStatefulWidget {
  const AuditLogScreen({super.key});

  @override
  ConsumerState<AuditLogScreen> createState() => _AuditLogScreenState();
}

class _AuditLogScreenState extends ConsumerState<AuditLogScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  /// Tunggu pengguna berhenti mengetik sebelum menembak query — tanpa ini
  /// setiap huruf memicu satu request ke Supabase.
  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      ref.read(auditFilterProvider.notifier).update(
            (f) => f.reset(search: value),
          );
    });
  }

  @override
  Widget build(BuildContext context) {
    final filter = ref.watch(auditFilterProvider);
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
      body: Column(
        children: [
          _SearchField(
            controller: _searchController,
            onChanged: _onSearchChanged,
            onClear: () {
              _searchController.clear();
              _onSearchChanged('');
            },
          ),
          _RangeBar(
            selected: filter.range,
            onSelect: (r) => ref
                .read(auditFilterProvider.notifier)
                .update((f) => f.reset(range: r)),
          ),
          _GroupBar(
            selected: filter.group,
            onSelect: (g) => ref.read(auditFilterProvider.notifier).update(
                  (f) => g == null ? f.reset(clearGroup: true) : f.reset(group: g),
                ),
          ),
          const Divider(height: 1),
          Expanded(
            child: async.when(
              loading: () => const AppSkeletonList(),
              error: (e, _) =>
                  AppErrorState(error: e, title: 'Gagal memuat riwayat'),
              data: (page) {
                if (page.entries.isEmpty) {
                  return const Center(
                    child: Padding(
                      padding: EdgeInsets.all(32),
                      child: Text(
                        'Tidak ada aktivitas pada rentang & filter ini.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.slate500),
                      ),
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(auditLogsProvider),
                  child: ListView.separated(
                    key: const Key('audit-list'),
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                    // +1 baris untuk kaki daftar (tombol muat lebih / penutup).
                    itemCount: page.entries.length + 1,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      if (i == page.entries.length) {
                        return _ListFooter(
                          count: page.entries.length,
                          hasMore: page.hasMore,
                          onLoadMore: () => ref
                              .read(auditFilterProvider.notifier)
                              .update((f) => f.nextPage),
                        );
                      }
                      return _EntryTile(entry: page.entries[i]);
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: TextField(
        key: const Key('audit-search'),
        controller: controller,
        onChanged: onChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          isDense: true,
          hintText: 'Cari aksi atau ID target…',
          prefixIcon: const Icon(Icons.search, size: 20),
          suffixIcon: ValueListenableBuilder<TextEditingValue>(
            valueListenable: controller,
            builder: (_, value, __) => value.text.isEmpty
                ? const SizedBox.shrink()
                : IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    tooltip: 'Hapus pencarian',
                    onPressed: onClear,
                  ),
          ),
        ),
      ),
    );
  }
}

class _RangeBar extends StatelessWidget {
  const _RangeBar({required this.selected, required this.onSelect});

  final AuditRange selected;
  final ValueChanged<AuditRange> onSelect;

  @override
  Widget build(BuildContext context) {
    return AppFilterChipBar(
      key: const Key('audit-range'),
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      children: [
        for (final r in AuditRange.values)
          AppFilterChip(
            label: r.label,
            selected: selected == r,
            onTap: () => onSelect(r),
          ),
      ],
    );
  }
}

class _GroupBar extends StatelessWidget {
  const _GroupBar({required this.selected, required this.onSelect});

  final String? selected;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    return AppFilterChipBar(
      key: const Key('audit-group'),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
      children: [
        AppFilterChip(
          label: 'Semua',
          selected: selected == null,
          onTap: () => onSelect(null),
        ),
        for (final g in _auditGroups)
          AppFilterChip(
            label: groupLabel(g),
            selected: selected == g,
            onTap: () => onSelect(g),
          ),
      ],
    );
  }
}

class _ListFooter extends StatelessWidget {
  const _ListFooter({
    required this.count,
    required this.hasMore,
    required this.onLoadMore,
  });

  final int count;
  final bool hasMore;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        children: [
          if (hasMore)
            OutlinedButton.icon(
              key: const Key('audit-load-more'),
              onPressed: onLoadMore,
              icon: const Icon(Icons.expand_more, size: 18),
              label: const Text('Muat lebih banyak'),
            )
          else
            Text(
              count == 0 ? '' : 'Semua $count aktivitas sudah ditampilkan.',
              style: const TextStyle(fontSize: 12, color: AppColors.slate400),
            ),
        ],
      ),
    );
  }
}

String groupLabel(String group) => switch (group) {
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
        .toList()
      // Urut abjad label supaya posisi field tidak berubah-ubah antar baris
      // (urutan kunci JSON dari Postgres tidak dijamin stabil).
      ..sort((a, b) =>
          auditDetailLabel(a.key).compareTo(auditDetailLabel(b.key)));

    // Kartu ini memakai `Card` (bukan Container berdekorasi) karena ExpansionTile
    // memakai ListTile di dalamnya: ListTile melukis background dan ripple pada
    // Material terdekat, jadi dekorasi berwarna di antaranya membuat Flutter
    // melempar assertion "ListTile background color or ink splashes may be
    // invisible" sekaligus menelan efek ripple-nya.
    return Card(
      clipBehavior: Clip.antiAlias,
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
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Row(
              children: [
                const Icon(Icons.person_outline,
                    size: 12, color: AppColors.slate400),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    entry.actorName.isNotEmpty ? entry.actorName : 'Sistem',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.slate500),
                  ),
                ),
                if (entry.at != null) ...[
                  const SizedBox(width: 8),
                  const Icon(Icons.schedule,
                      size: 12, color: AppColors.slate400),
                  const SizedBox(width: 4),
                  Text(
                    formatAuditTime(entry.at!),
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.slate500),
                  ),
                ],
              ],
            ),
          ),
          children: [
            _DetailRow(label: 'Aksi', value: entry.action),
            if (entry.target.isNotEmpty)
              _DetailRow(label: 'Target', value: entry.target),
            for (final d in details)
              _DetailRow(
                label: auditDetailLabel(d.key),
                value: auditDetailValue(d.key, d.value),
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
