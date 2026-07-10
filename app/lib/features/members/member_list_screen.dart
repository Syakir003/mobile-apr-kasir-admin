import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/member.dart';
import '../master/widgets/master_list_scaffold.dart';
import 'member_providers.dart';

class MemberListScreen extends ConsumerWidget {
  const MemberListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(membersStreamProvider);
    return MasterListScaffold<Member>(
      title: 'Member',
      items: items,
      titleOf: (m) => m.name,
      subtitleOf: (m) => m.phone,
      isActive: (m) => m.active,
      matches: (m, q) =>
          m.name.toLowerCase().contains(q.toLowerCase()) || m.phone.contains(q),
      searchHint: 'Cari nama / nomor HP...',
      onAdd: () => context.go('/members/new'),
      onEdit: (m) => context.go('/members/${m.id}', extra: m),
    );
  }
}
