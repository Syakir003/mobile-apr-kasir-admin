import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/utils/currency.dart';
import '../../../data/models/product.dart';
import '../master_providers.dart';
import '../widgets/master_list_scaffold.dart';

class ProductListScreen extends ConsumerWidget {
  const ProductListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(productListProvider);
    return MasterListScaffold<Product>(
      title: 'Produk AC',
      items: items,
      titleOf: (p) => p.name,
      subtitleOf: (p) =>
          '${p.brand} • ${p.category} • ${formatRupiah(p.sellPrice)}',
      isActive: (p) => p.active,
      matches: (p, q) => p.name.toLowerCase().contains(q.toLowerCase()),
      onAdd: () => context.go('/products/new'),
      onEdit: (p) => context.go('/products/${p.id}/edit', extra: p),
    );
  }
}
