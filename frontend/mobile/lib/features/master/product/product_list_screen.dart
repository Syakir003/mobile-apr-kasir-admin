import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/utils/currency.dart';
import '../../../data/models/app_user.dart';
import '../../../data/models/product.dart';
import '../master_providers.dart';
import '../widgets/master_list_scaffold.dart';

class ProductListScreen extends ConsumerWidget {
  const ProductListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(productListProvider);
    // Gudang hanya melihat: ubah/tambah produk & harga jual admin-only (backend).
    final isAdmin = ref.watch(currentUserProvider).value?.role == UserRole.admin;
    return MasterListScaffold<Product>(
      title: 'Produk AC',
      items: items,
      titleOf: (p) => p.name,
      subtitleOf: (p) => isAdmin
          ? '${p.brand} • ${p.category} • ${formatRupiah(p.sellPrice)}'
          : '${p.brand} • ${p.category}',
      isActive: (p) => p.active,
      matches: (p, q) => p.name.toLowerCase().contains(q.toLowerCase()),
      onAdd: isAdmin ? () => context.go('/products/new') : null,
      onEdit: isAdmin
          ? (p) => context.go('/products/${p.id}/edit', extra: p)
          : null,
    );
  }
}
