import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/utils/currency.dart';
import '../../../data/models/app_user.dart';
import '../../../data/models/sparepart.dart';
import '../master_providers.dart';
import '../widgets/master_list_scaffold.dart';

class SparepartListScreen extends ConsumerWidget {
  const SparepartListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(sparepartListProvider);
    // Gudang hanya melihat: ubah/tambah sparepart & harga jual admin-only (backend).
    final isAdmin = ref.watch(currentUserProvider).value?.role == UserRole.admin;
    return MasterListScaffold<Sparepart>(
      title: 'Sparepart & Material',
      items: items,
      titleOf: (s) => s.name,
      subtitleOf: (s) => isAdmin
          ? '${s.sku} • ${s.category} • ${formatRupiah(s.sellPrice)}/${s.unit} • stok ${s.stock}'
          : '${s.sku} • ${s.category} • stok ${s.stock} ${s.unit}',
      isActive: (s) => s.active,
      matches: (s, q) => s.name.toLowerCase().contains(q.toLowerCase()),
      onAdd: isAdmin ? () => context.go('/spareparts/new') : null,
      onEdit: isAdmin
          ? (s) => context.go('/spareparts/${s.id}/edit', extra: s)
          : null,
    );
  }
}
