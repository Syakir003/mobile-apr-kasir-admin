import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/product.dart';
import '../../data/models/service_item.dart';
import '../../data/models/sparepart.dart';
import '../master/master_providers.dart';
import 'cart_state.dart';
import 'pos_providers.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';

/// Bottom sheet pemilihan item (Produk/Sparepart/Jasa) untuk ditambahkan ke
/// keranjang POS. Dibuka lewat `showModalBottomSheet` dari `pos_screen.dart`.
class ItemPickerSheet extends ConsumerStatefulWidget {
  const ItemPickerSheet({super.key});

  @override
  ConsumerState<ItemPickerSheet> createState() => _ItemPickerSheetState();
}

class _ItemPickerSheetState extends ConsumerState<ItemPickerSheet> {
  final _query = TextEditingController();
  String _filter = '';

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  bool _matches(String name) =>
      _filter.isEmpty || name.toLowerCase().contains(_filter);

  void _addProduct(Product p) {
    ref.read(cartProvider.notifier).addLine(
          CartLine(
            kind: CartItemKind.product,
            refId: p.id,
            name: p.name,
            unit: 'unit',
            unitPrice: p.sellPrice,
            qty: 1,
          ),
        );
    Navigator.of(context).pop();
  }

  void _addSparepart(Sparepart s) {
    ref.read(cartProvider.notifier).addLine(
          CartLine(
            kind: CartItemKind.sparepart,
            refId: s.id,
            name: s.name,
            unit: s.unit,
            unitPrice: s.sellPrice,
            qty: 1,
          ),
        );
    Navigator.of(context).pop();
  }

  void _addService(ServiceItem s) {
    ref.read(cartProvider.notifier).addLine(
          CartLine(
            kind: CartItemKind.service,
            refId: s.id,
            name: s.name,
            unit: 'jasa',
            unitPrice: s.basePrice,
            qty: 1,
          ),
        );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final products = ref.watch(productListProvider);
    final spareparts = ref.watch(sparepartListProvider);
    final services = ref.watch(serviceListProvider);

    return DefaultTabController(
      length: 3,
      child: SafeArea(
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.85,
          child: Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.slate300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: TextField(
                  key: const Key('item-filter'),
                  controller: _query,
                  // Kotak cari memakai hint, bukan label melayang: labelnya
                  // menyusut jadi 12px begitu diketik, padahal kata kuncinya
                  // sendiri yang perlu terbaca.
                  decoration: const InputDecoration(
                    hintText: 'Cari nama item',
                    prefixIcon: Icon(Icons.search),
                    isDense: true,
                  ),
                  onChanged: (v) =>
                      setState(() => _filter = v.trim().toLowerCase()),
                ),
              ),
              const TabBar(tabs: [
                Tab(text: 'Produk'),
                Tab(text: 'Sparepart'),
                Tab(text: 'Jasa'),
              ]),
              Expanded(
                child: TabBarView(
                  children: [
                    _ProductTab(
                      products: products,
                      matches: _matches,
                      onTap: _addProduct,
                    ),
                    _SparepartTab(
                      spareparts: spareparts,
                      matches: _matches,
                      onTap: _addSparepart,
                    ),
                    _ServiceTab(
                      services: services,
                      matches: _matches,
                      onTap: _addService,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProductTab extends StatelessWidget {
  const _ProductTab({
    required this.products,
    required this.matches,
    required this.onTap,
  });

  final AsyncValue<List<Product>> products;
  final bool Function(String name) matches;
  final void Function(Product) onTap;

  @override
  Widget build(BuildContext context) {
    return products.when(
      data: (list) {
        final filtered =
            list.where((p) => p.active && matches(p.name.toLowerCase())).toList();
        if (filtered.isEmpty) {
          return const Center(child: Text('Tidak ada produk.'));
        }
        return ListView.builder(
          itemCount: filtered.length,
          itemBuilder: (_, i) {
            final p = filtered[i];
            return ListTile(
              key: Key('product-${p.id}'),
              title: Text(p.name,
                  style: const TextStyle(fontWeight: FontWeight.w500)),
              subtitle: Text('Stok: ${p.stock} • ${p.brand}',
                  style: const TextStyle(color: AppColors.slate500)),
              trailing: Text(formatRupiah(p.sellPrice),
                  style: const TextStyle(
                      color: AppColors.teal700, fontWeight: FontWeight.bold)),
              onTap: () => onTap(p),
            );
          },
        );
      },
      loading: () => const AppSkeletonList(),
      error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat produk'),
    );
  }
}

class _SparepartTab extends StatelessWidget {
  const _SparepartTab({
    required this.spareparts,
    required this.matches,
    required this.onTap,
  });

  final AsyncValue<List<Sparepart>> spareparts;
  final bool Function(String name) matches;
  final void Function(Sparepart) onTap;

  @override
  Widget build(BuildContext context) {
    return spareparts.when(
      data: (list) {
        final filtered =
            list.where((s) => s.active && matches(s.name.toLowerCase())).toList();
        if (filtered.isEmpty) {
          return const Center(child: Text('Tidak ada sparepart.'));
        }
        return ListView.builder(
          itemCount: filtered.length,
          itemBuilder: (_, i) {
            final s = filtered[i];
            return ListTile(
              key: Key('sparepart-${s.id}'),
              title: Text(s.name,
                  style: const TextStyle(fontWeight: FontWeight.w500)),
              subtitle: Text('Stok: ${s.stock} ${s.unit}',
                  style: const TextStyle(color: AppColors.slate500)),
              trailing: Text(formatRupiah(s.sellPrice),
                  style: const TextStyle(
                      color: AppColors.teal700, fontWeight: FontWeight.bold)),
              onTap: () => onTap(s),
            );
          },
        );
      },
      loading: () => const AppSkeletonList(),
      error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat sparepart'),
    );
  }
}

class _ServiceTab extends StatelessWidget {
  const _ServiceTab({
    required this.services,
    required this.matches,
    required this.onTap,
  });

  final AsyncValue<List<ServiceItem>> services;
  final bool Function(String name) matches;
  final void Function(ServiceItem) onTap;

  @override
  Widget build(BuildContext context) {
    return services.when(
      data: (list) {
        final filtered =
            list.where((s) => s.active && matches(s.name.toLowerCase())).toList();
        if (filtered.isEmpty) {
          return const Center(child: Text('Tidak ada jasa.'));
        }
        return ListView.builder(
          itemCount: filtered.length,
          itemBuilder: (_, i) {
            final s = filtered[i];
            return ListTile(
              key: Key('service-${s.id}'),
              title: Text(s.name,
                  style: const TextStyle(fontWeight: FontWeight.w500)),
              subtitle: Text(s.category,
                  style: const TextStyle(color: AppColors.slate500)),
              trailing: Text(formatRupiah(s.basePrice),
                  style: const TextStyle(
                      color: AppColors.teal700, fontWeight: FontWeight.bold)),
              onTap: () => onTap(s),
            );
          },
        );
      },
      loading: () => const AppSkeletonList(),
      error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat jasa'),
    );
  }
}
