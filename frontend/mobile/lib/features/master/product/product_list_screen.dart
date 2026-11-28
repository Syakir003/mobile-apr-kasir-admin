import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/utils/currency.dart';
import '../../../data/models/app_user.dart';
import '../../../data/models/product.dart';
import '../master_providers.dart';
import '../widgets/fix_pending_dialog.dart';
import '../widgets/master_list_scaffold.dart';

class ProductListScreen extends ConsumerWidget {
  const ProductListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(productListProvider);
    // Harga jual & status aktif admin-only (backend).
    final isAdmin = ref.watch(currentUserProvider).value?.role == UserRole.admin;
    final isGudang = ref.watch(currentUserProvider).value?.role == UserRole.gudang;
    return MasterListScaffold<Product>(
      title: 'Produk AC',
      items: items,
      onOpen: () => ref.invalidate(productListProvider),
      titleOf: (p) => p.name,
      subtitleOf: (p) => isAdmin
          ? '${p.brand} • ${p.category} • ${formatRupiah(p.sellPrice)}'
          : '${p.brand} • ${p.category}',
      isActive: (p) => p.active,
      matches: (p, q) => p.name.toLowerCase().contains(q.toLowerCase()),
      // Gudang boleh menambah, dan membetulkan yang masih menunggu harga.
      isPending: (p) => p.pendingPrice,
      canEdit: isGudang ? (p) => p.pendingPrice : null,
      onAdd: isAdmin || isGudang ? () => context.go('/products/new') : null,
      onEdit: isAdmin
          ? (p) => context.go('/products/${p.id}/edit', extra: p)
          : isGudang
              ? (p) async {
                  final saved = await showFixPendingDialog(
                    context,
                    path: '/products/${p.id}',
                    name: p.name,
                    category: p.category,
                  );
                  if (saved) ref.invalidate(productListProvider);
                }
              : null,
    );
  }
}
