import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../data/models/sparepart.dart';
import '../master_providers.dart';
import '../widgets/master_list_scaffold.dart';

class SparepartListScreen extends ConsumerWidget {
  const SparepartListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(sparepartListProvider);
    return MasterListScaffold<Sparepart>(
      title: 'Sparepart & Material',
      items: items,
      titleOf: (s) => s.name,
      subtitleOf: (s) =>
          '${s.sku} • ${s.category} • Rp ${s.sellPrice}/${s.unit} • stok ${s.stock}',
      isActive: (s) => s.active,
      matches: (s, q) => s.name.toLowerCase().contains(q.toLowerCase()),
      onAdd: () => context.go('/spareparts/new'),
      onEdit: (s) => context.go('/spareparts/${s.id}/edit', extra: s),
    );
  }
}
