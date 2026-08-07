import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/data_table_card.dart';
import '../../core/widgets/initials_avatar.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/invoice.dart';
import '../pos/cart_state.dart' show formatRupiah;
import '../transactions/invoice_detail_screen.dart' show statusColor;

/// Kartu "Transaksi Terkini" (10:185).
class RecentTransactionsCard extends StatelessWidget {
  const RecentTransactionsCard({super.key, required this.invoices});

  final List<Invoice> invoices;

  static const _maxRows = 5;

  /// Ringkasan layanan: nama item pertama, sisanya diringkas jadi "+n".
  static String _layanan(Invoice inv) {
    final items = inv.items;
    if (items.isEmpty) return '-';
    if (items.length == 1) return items.first.name;
    return '${items.first.name} +${items.length - 1}';
  }

  static String _pelanggan(Invoice inv) =>
      inv.customerName.isEmpty ? 'Umum' : inv.customerName;

  @override
  Widget build(BuildContext context) {
    final shown = invoices.take(_maxRows).toList();

    return DataTableCard(
      title: 'Transaksi Terkini',
      emptyMessage: 'Belum ada transaksi.',
      action: TextButton.icon(
        onPressed: () => context.go('/transactions'),
        iconAlignment: IconAlignment.end,
        icon: const Icon(Icons.arrow_forward, size: 14),
        label: const Text('Lihat Semua'),
      ),
      columns: const [
        TableColumnSpec(label: 'Invoice ID', flex: 4),
        TableColumnSpec(label: 'Pelanggan', flex: 5),
        TableColumnSpec(label: 'Layanan', flex: 5),
        TableColumnSpec(label: 'Status', flex: 4),
        TableColumnSpec(label: 'Jumlah', flex: 4, alignRight: true),
      ],
      rowCount: shown.length,
      onRowTap: (i) => context.go('/transactions/${shown[i].id}'),
      cellsBuilder: (i) {
        final inv = shown[i];
        return [
          Text(
            '#${inv.number}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.monoCode.copyWith(color: AppColors.navAccent),
          ),
          Row(
            children: [
              InitialsAvatar(name: _pelanggan(inv), highlighted: i == 0),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _pelanggan(inv),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: AppFonts.body,
                    fontSize: 16,
                    height: 24 / 16,
                    color: AppColors.textInk,
                  ),
                ),
              ),
            ],
          ),
          Text(
            _layanan(inv),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 16,
              height: 24 / 16,
              color: AppColors.textInk,
            ),
          ),
          StatusBadge(
            label: inv.status.label,
            color: statusColor(inv.status),
            constrained: true,
          ),
          Text(
            formatRupiah(inv.grandTotal),
            maxLines: 1,
            textAlign: TextAlign.right,
            style: AppTextStyles.monoCode.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
        ];
      },
      narrowBuilder: (i) {
        final inv = shown[i];
        return Row(
          children: [
            InitialsAvatar(name: _pelanggan(inv), highlighted: i == 0),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '#${inv.number}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.monoCode
                        .copyWith(color: AppColors.navAccent),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _pelanggan(inv),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: AppFonts.body,
                      fontSize: 15,
                      height: 20 / 15,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textInk,
                    ),
                  ),
                  Text(
                    _layanan(inv),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: AppFonts.body,
                      fontSize: 12,
                      height: 16 / 12,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                StatusBadge(
                  label: inv.status.label,
                  color: statusColor(inv.status),
                ),
                const SizedBox(height: 6),
                Text(
                  formatRupiah(inv.grandTotal),
                  style: AppTextStyles.monoCode
                      .copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ],
        );
      },
    );
  }
}
