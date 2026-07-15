import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../pos/cart_state.dart' show formatRupiah;
import 'invoice_detail_screen.dart' show statusColor;
import 'invoice_providers.dart';

/// Riwayat transaksi/invoice (100 terakhir). Transaksi dibuat dari `/pos`,
/// jadi layar ini tanpa tombol tambah.
class InvoiceListScreen extends ConsumerWidget {
  const InvoiceListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invoicesAsync = ref.watch(invoicesStreamProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Riwayat')),
      body: invoicesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Gagal memuat: $e')),
        data: (invoices) {
          if (invoices.isEmpty) {
            return const Center(child: Text('Belum ada transaksi.'));
          }
          return ListView.separated(
            itemCount: invoices.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (_, i) {
              final inv = invoices[i];
              return ListTile(
                title: Text(inv.number),
                subtitle: Text(
                  '${inv.customerName} • ${formatRupiah(inv.grandTotal)}',
                ),
                trailing: Chip(
                  label: Text(inv.status.label),
                  labelStyle: TextStyle(
                    color: statusColor(inv.status),
                    fontWeight: FontWeight.w600,
                  ),
                  visualDensity: VisualDensity.compact,
                ),
                onTap: () => context.go('/transactions/${inv.id}'),
              );
            },
          );
        },
      ),
    );
  }
}
