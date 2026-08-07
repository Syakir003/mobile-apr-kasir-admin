import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_motion.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_skeleton.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_badge.dart';

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
                // Tombol hapus muncul memudar begitu ada isian, bukan
                // berkedip masuk-keluar per ketikan.
                suffixIcon: AppSwap(
                  alignment: Alignment.center,
                  switchKey: _query.isEmpty,
                  child: _query.isEmpty
                      ? const SizedBox.shrink()
                      : IconButton(
                          icon: const Icon(Icons.close, size: 18),
                          tooltip: 'Hapus pencarian',
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _query = '');
                          },
                        ),
                ),
              ),
              onChanged: (v) => setState(() => _query = v.trim()),
            ),
          ),
          Expanded(
            child: AppSwap(
              alignment: Alignment.topCenter,
              switchKey: widget.items.hasValue
                  ? 'data'
                  : (widget.items.hasError ? 'error' : 'loading'),
              child: _buildList(context),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildList(BuildContext context) {
    return widget.items.when(
      // Kerangka baris, bukan spinner: bentuk daftar sudah terlihat sebelum
      // datanya sampai, jadi tidak ada lompatan dari layar kosong ke daftar.
      loading: () => const AppSkeletonList(),
      error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat data'),
      data: (all) {
        final filtered = _query.isEmpty
            ? all
            : all.where((item) => widget.matches(item, _query)).toList();
        if (filtered.isEmpty) {
          return AppEmptyState(
            icon: _query.isEmpty ? Icons.inbox_outlined : Icons.search_off,
            title: _query.isEmpty
                ? 'Belum ada data'
                : 'Tidak ada yang cocok',
            message: _query.isEmpty
                ? 'Tekan tombol Tambah untuk membuat entri pertama.'
                : 'Coba kata kunci lain, atau kosongkan kolom pencarian.',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
          itemCount: filtered.length,
          separatorBuilder: (_, __) => const SizedBox(height: 10),
          itemBuilder: (context, index) {
            final item = filtered[index];
            return AppRevealIn.at(
              index,
              rise: 10,
              child: _MasterCard(
                title: widget.titleOf(item),
                subtitle: widget.subtitleOf(item),
                active: widget.isActive(item),
                onTap: () => widget.onEdit(item),
              ),
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
    return AppPressable(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.lg),
      child: Ink(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppRadius.lg),
          boxShadow: AppShadows.metric,
        ),
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
              StatusBadge.tone(
                active ? AppBadgeTone.success : AppBadgeTone.draft,
                label: active ? 'Aktif' : 'Nonaktif',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
