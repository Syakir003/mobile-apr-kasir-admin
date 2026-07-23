import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/service_order.dart';
import 'job_providers.dart';

/// Ringkasan order service (admin/kasir): member, jenis, progres unit selesai,
/// dan status. Order pemasangan lahir dari checkout POS; order service/
/// maintenance/cuci dibuat manual lewat tombol tambah. Penugasan & pengerjaan
/// dilakukan di menu Job Teknisi.
class ServiceOrderListScreen extends ConsumerWidget {
  const ServiceOrderListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ordersAsync = ref.watch(ordersProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Order Service'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(ordersProvider),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/orders/new'),
        icon: const Icon(Icons.add),
        label: const Text('Order Baru'),
      ),
      body: ordersAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('Gagal memuat order: $e',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.slate500)),
          ),
        ),
        data: (orders) {
          if (orders.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.assignment_outlined,
                      size: 48, color: AppColors.slate300),
                  SizedBox(height: 12),
                  Text('Belum ada order service.',
                      style: TextStyle(color: AppColors.slate500)),
                ],
              ),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            itemCount: orders.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (_, i) => _OrderCard(order: orders[i]),
          );
        },
      ),
    );
  }
}

Color _orderStatusColor(OrderStatus s) => switch (s) {
      OrderStatus.selesai => AppColors.success,
      OrderStatus.dalamPengerjaan => AppColors.warning,
      OrderStatus.dibatalkan => AppColors.textSecondary,
      OrderStatus.draft => AppColors.slate500,
      OrderStatus.terjadwal => AppColors.blue600,
    };

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order});
  final ServiceOrder order;

  @override
  Widget build(BuildContext context) {
    final color = _orderStatusColor(order.status);
    final progress =
        order.unitCount == 0 ? 0.0 : order.doneCount / order.unitCount;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        order.memberName.isEmpty ? '-' : order.memberName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                          color: AppColors.slate900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(order.typeLabel,
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.slate500)),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    order.status.label,
                    style: TextStyle(
                        color: color,
                        fontSize: 11,
                        fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 6,
                backgroundColor: AppColors.slate100,
                valueColor:
                    const AlwaysStoppedAnimation(AppColors.teal600),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              '${order.doneCount}/${order.unitCount} unit selesai',
              style: const TextStyle(fontSize: 12, color: AppColors.slate500),
            ),
          ],
        ),
      ),
    );
  }
}
