import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/utils/currency.dart';
import '../../../data/models/app_user.dart';
import '../../../data/models/sparepart.dart';
import '../master_providers.dart';
import '../widgets/fix_pending_dialog.dart';
import '../widgets/master_list_scaffold.dart';

class SparepartListScreen extends ConsumerWidget {
  const SparepartListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(sparepartListProvider);
    // Harga jual & status aktif admin-only (backend).
    final isAdmin = ref.watch(currentUserProvider).value?.role == UserRole.admin;
    final isGudang = ref.watch(currentUserProvider).value?.role == UserRole.gudang;
    return MasterListScaffold<Sparepart>(
      title: 'Sparepart & Material',
      items: items,
      onOpen: () => ref.invalidate(sparepartListProvider),
      titleOf: (s) => s.name,
      subtitleOf: (s) => isAdmin
          ? '${s.sku} • ${s.category} • ${formatRupiah(s.sellPrice)}/${s.unit} • stok ${s.stock}'
          : '${s.sku} • ${s.category} • stok ${s.stock} ${s.unit}',
      isActive: (s) => s.active,
      matches: (s, q) => s.name.toLowerCase().contains(q.toLowerCase()),
      // Gudang boleh menambah, membetulkan yang menunggu harga, dan mengoreksi stok.
      isPending: (s) => s.pendingPrice,
      onAdd: isAdmin || isGudang ? () => context.go('/spareparts/new') : null,
      onEdit: isAdmin
          ? (s) => context.go('/spareparts/${s.id}/edit', extra: s)
          : isGudang
              ? (s) async {
                  // Menunggu harga: identitasnya masih boleh dibetulkan juga.
                  if (!s.pendingPrice) {
                    context.go('/stok/opname', extra: s.id);
                    return;
                  }
                  final saved = await showFixPendingDialog(
                    context,
                    path: '/spareparts/${s.id}',
                    name: s.name,
                    category: s.category,
          sku: s.sku,
                    onCorrectStock: () => context.go('/stok/opname', extra: s.id),
                  );
                  if (saved) ref.invalidate(sparepartListProvider);
                }
              : null,
    );
  }
}
