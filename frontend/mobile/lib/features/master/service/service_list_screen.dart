import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../data/models/service_item.dart';
import '../master_providers.dart';
import '../widgets/master_list_scaffold.dart';

class ServiceListScreen extends ConsumerWidget {
  const ServiceListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(serviceListProvider);
    return MasterListScaffold<ServiceItem>(
      title: 'Jasa',
      items: items,
      titleOf: (s) => s.name,
      subtitleOf: (s) => '${s.category} • Rp ${s.basePrice}',
      isActive: (s) => s.active,
      matches: (s, q) => s.name.toLowerCase().contains(q.toLowerCase()),
      onAdd: () => context.go('/services/new'),
      onEdit: (s) => context.go('/services/${s.id}/edit', extra: s),
    );
  }
}
