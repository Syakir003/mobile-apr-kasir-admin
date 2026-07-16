import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';

/// Scaffold generik untuk daftar master data: AppBar berjudul, kolom cari,
/// daftar item dengan badge "Nonaktif" bila tidak aktif, dan FAB tambah.
class MasterListScaffold<T> extends StatefulWidget {
  const MasterListScaffold({
    super.key,
    required this.title,
    required this.items,
    required this.titleOf,
    required this.subtitleOf,
    required this.isActive,
    required this.matches,
    required this.onAdd,
    required this.onEdit,
    this.searchHint = 'Cari nama...',
  });

  final String title;
  final AsyncValue<List<T>> items;
  final String Function(T item) titleOf;
  final String Function(T item) subtitleOf;
  final bool Function(T item) isActive;
  final bool Function(T item, String query) matches;
  final VoidCallback onAdd;
  final void Function(T item) onEdit;
  final String searchHint;

  @override
  State<MasterListScaffold<T>> createState() => _MasterListScaffoldState<T>();
}

class _MasterListScaffoldState<T> extends State<MasterListScaffold<T>> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('master-add'),
        onPressed: widget.onAdd,
        tooltip: 'Tambah',
        icon: const Icon(Icons.add),
        label: const Text('Tambah'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: TextField(
              key: const Key('master-search'),
              controller: _searchController,
              decoration: InputDecoration(
                hintText: widget.searchHint,
                prefixIcon: const Icon(Icons.search),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _query = v.trim()),
            ),
          ),
          Expanded(child: _buildList(context)),
        ],
      ),
    );
  }

  Widget _buildList(BuildContext context) {
    return widget.items.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text('Gagal memuat data: $e',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.slate500)),
        ),
      ),
      data: (all) {
        final filtered = _query.isEmpty
            ? all
            : all.where((item) => widget.matches(item, _query)).toList();
        if (filtered.isEmpty) {
          return const _EmptyState();
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
          itemCount: filtered.length,
          separatorBuilder: (_, __) => const SizedBox(height: 10),
          itemBuilder: (context, index) {
            final item = filtered[index];
            return _MasterCard(
              title: widget.titleOf(item),
              subtitle: widget.subtitleOf(item),
              active: widget.isActive(item),
              onTap: () => widget.onEdit(item),
            );
          },
        );
      },
    );
  }
}

class _MasterCard extends StatelessWidget {
  const _MasterCard({
    required this.title,
    required this.subtitle,
    required this.active,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final initial = title.trim().isEmpty
        ? '?'
        : title.trim().characters.first.toUpperCase();
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.teal50,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                alignment: Alignment.center,
                child: Text(
                  initial,
                  style: const TextStyle(
                    color: AppColors.teal700,
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                        color: AppColors.slate900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.slate500,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              _StatusBadge(active: active),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.active});
  final bool active;

  @override
  Widget build(BuildContext context) {
    final bg = active ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7);
    final fg = active ? AppColors.green600 : AppColors.warning;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        active ? 'Aktif' : 'Nonaktif',
        style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();
  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.inbox_outlined, size: 48, color: AppColors.slate300),
          SizedBox(height: 12),
          Text('Belum ada data.', style: TextStyle(color: AppColors.slate500)),
        ],
      ),
    );
  }
}
