import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/ac_unit.dart';
import '../../data/models/member.dart';
import 'member_providers.dart';

class MemberDetailScreen extends ConsumerWidget {
  const MemberDetailScreen({super.key, required this.memberId, this.initial});

  final String memberId;

  /// Member dari navigasi (extra); fallback selagi stream belum terisi.
  final Member? initial;

  Member? _fromList(List<Member>? members) {
    if (members == null) return null;
    for (final m in members) {
      if (m.id == memberId) return m;
    }
    return null;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final member =
        _fromList(ref.watch(membersStreamProvider).value) ?? initial;
    final units = ref.watch(memberUnitsProvider(memberId));

    return Scaffold(
      appBar: AppBar(
        title: Text(member?.name ?? 'Member'),
        actions: [
          IconButton(
            key: const Key('edit-member'),
            icon: const Icon(Icons.edit_outlined),
            tooltip: 'Edit Member',
            onPressed: member == null
                ? null
                : () => context.go('/members/$memberId/edit', extra: member),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        key: const Key('add-unit'),
        tooltip: 'Tambah Unit AC',
        onPressed: () => context.go('/members/$memberId/units/new'),
        child: const Icon(Icons.add),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (member != null) _MemberCard(member: member),
          const SizedBox(height: 16),
          Text('Unit AC', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          units.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Text('Gagal memuat unit: $e'),
            data: (list) => list.isEmpty
                ? const Text('Belum ada unit AC.')
                : Column(
                    children: [
                      for (final u in list)
                        Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          child: ListTile(
                            leading: const Icon(Icons.ac_unit),
                            title: Text('${u.brand} ${u.model}'),
                            subtitle: Text(_unitSubtitle(u)),
                            isThreeLine: true,
                            onTap: () => context.go(
                              '/members/$memberId/units/${u.id}/edit',
                              extra: u,
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  String _unitSubtitle(AcUnit u) {
    final barcode =
        u.barcodeValue.isEmpty ? 'Barcode belum digenerate' : u.barcodeValue;
    return '${u.pk} PK • ${u.roomLocation.isEmpty ? '-' : u.roomLocation} • '
        '${u.status.label}\n$barcode';
  }
}

class _MemberCard extends StatelessWidget {
  const _MemberCard({required this.member});

  final Member member;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    member.name,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                if (!member.active)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF3C7),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Text(
                      'Nonaktif',
                      style: TextStyle(
                        color: AppColors.warning,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            _InfoRow(icon: Icons.phone_outlined, text: member.phone),
            if (member.address.isNotEmpty)
              _InfoRow(icon: Icons.home_outlined, text: member.address),
            _InfoRow(icon: Icons.category_outlined, text: member.customerType),
            if (member.notes != null && member.notes!.isNotEmpty)
              _InfoRow(icon: Icons.notes_outlined, text: member.notes!),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: Theme.of(context).colorScheme.outline),
          const SizedBox(width: 8),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
