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
      floatingActionButton: FloatingActionButton(
        key: const Key('master-add'),
        onPressed: widget.onAdd,
        tooltip: 'Tambah',
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              key: const Key('master-search'),
              controller: _searchController,
              decoration: InputDecoration(
                hintText: widget.searchHint,
                prefixIcon: const Icon(Icons.search),
                border: const OutlineInputBorder(),
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
      error: (e, _) => Center(child: Text('Gagal memuat data: $e')),
      data: (all) {
        final filtered = _query.isEmpty
            ? all
            : all.where((item) => widget.matches(item, _query)).toList();
        if (filtered.isEmpty) {
          return const Center(child: Text('Belum ada data.'));
        }
        return ListView.separated(
          itemCount: filtered.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final item = filtered[index];
            final active = widget.isActive(item);
            return ListTile(
              title: Text(widget.titleOf(item)),
              subtitle: Text(widget.subtitleOf(item)),
              trailing: active
                  ? null
                  : Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF3C7),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Text(
                        'Nonaktif',
                        style: TextStyle(
                          color: AppColors.warning,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
              onTap: () => widget.onEdit(item),
            );
          },
        );
      },
    );
  }
}
