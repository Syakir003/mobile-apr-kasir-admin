import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/invoice.dart';
import '../../data/models/manual_payment.dart';
import '../pos/cart_state.dart' show formatRupiah;
import 'invoice_providers.dart';
import 'payment_form_sheet.dart';
import 'receipt_pdf.dart';

/// Warna chip status invoice (dipakai layar detail & daftar).
Color statusColor(InvoiceStatus status) => switch (status) {
      InvoiceStatus.lunas => AppColors.success,
      InvoiceStatus.dp => AppColors.warning,
      InvoiceStatus.kurangBayar => AppColors.warning,
      InvoiceStatus.belumDibayar => AppColors.danger,
      InvoiceStatus.refund => AppColors.textSecondary,
      InvoiceStatus.batal => AppColors.textSecondary,
    };

/// Detail satu invoice: info, item, ringkasan, daftar pembayaran, plus aksi
/// catat pembayaran & bagikan struk.
class InvoiceDetailScreen extends ConsumerWidget {
  const InvoiceDetailScreen({super.key, required this.invoiceId});

  final String invoiceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invoiceAsync = ref.watch(invoiceProvider(invoiceId));
    final paymentsAsync = ref.watch(invoicePaymentsProvider(invoiceId));

    return Scaffold(
      appBar: AppBar(title: const Text('Detail Transaksi')),
      body: invoiceAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Gagal memuat: $e')),
        data: (invoice) {
          if (invoice == null) {
            return const Center(child: Text('Invoice tidak ditemukan.'));
          }
          final payments = paymentsAsync.value ?? const <ManualPayment>[];
          final canPay = invoice.status != InvoiceStatus.lunas &&
              invoice.status != InvoiceStatus.batal;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _InfoCard(invoice: invoice),
              const SizedBox(height: 12),
              _ItemsCard(invoice: invoice),
              const SizedBox(height: 12),
              _TotalsCard(invoice: invoice),
              const SizedBox(height: 12),
              _PaymentsCard(payments: payments),
              const SizedBox(height: 20),
              if (canPay)
                FilledButton.icon(
                  key: const Key('add-payment'),
                  onPressed: () => showPaymentFormSheet(context, invoice),
                  icon: const Icon(Icons.payments_outlined),
                  label: const Text('Catat Pembayaran'),
                ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                key: const Key('print-receipt'),
                onPressed: () => Printing.layoutPdf(
                  onLayout: (_) => buildReceiptPdf(invoice, payments),
                ),
                icon: const Icon(Icons.receipt_long_outlined),
                label: const Text('Bagikan Struk'),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    invoice.number,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                ),
                Chip(
                  label: Text(invoice.status.label),
                  labelStyle: TextStyle(
                    color: statusColor(invoice.status),
                    fontWeight: FontWeight.w600,
                  ),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(invoice.customerName),
            if (invoice.customerPhone.isNotEmpty) Text(invoice.customerPhone),
            if (invoice.createdAt != null)
              Text(
                _formatDate(invoice.createdAt!),
                style: const TextStyle(
                    fontSize: 12, color: AppColors.textSecondary),
              ),
          ],
        ),
      ),
    );
  }
}

class _ItemsCard extends StatelessWidget {
  const _ItemsCard({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Item', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            for (final item in invoice.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.name),
                          Text(
                            '${_trimZero(item.qty)} ${item.unit} × ${formatRupiah(item.unitPrice)}',
                            style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    Text(formatRupiah(item.lineTotal)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TotalsCard extends StatelessWidget {
  const _TotalsCard({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _row('Subtotal', formatRupiah(invoice.subtotal)),
            if (invoice.discount > 0)
              _row('Diskon', '- ${formatRupiah(invoice.discount)}'),
            if (invoice.taxAmount > 0)
              _row('Pajak (${_trimZero(invoice.taxPercent)}%)',
                  formatRupiah(invoice.taxAmount)),
            if (invoice.transportFee > 0)
              _row('Transport', formatRupiah(invoice.transportFee)),
            const Divider(),
            _row('Total', formatRupiah(invoice.grandTotal), bold: true),
            _row('Dibayar', formatRupiah(invoice.totalPaid)),
            _row('Sisa', formatRupiah(invoice.sisa), bold: true),
          ],
        ),
      ),
    );
  }
}

class _PaymentsCard extends StatelessWidget {
  const _PaymentsCard({required this.payments});

  final List<ManualPayment> payments;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Pembayaran',
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            if (payments.isEmpty)
              const Text('Belum ada pembayaran.',
                  style: TextStyle(color: AppColors.textSecondary))
            else
              for (final p in payments)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(p.method.label),
                            if (p.createdAt != null)
                              Text(
                                _formatDate(p.createdAt!),
                                style: const TextStyle(
                                    fontSize: 12,
                                    color: AppColors.textSecondary),
                              ),
                          ],
                        ),
                      ),
                      Text(formatRupiah(p.amount)),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

Widget _row(String label, String value, {bool bold = false}) {
  final style = bold ? const TextStyle(fontWeight: FontWeight.bold) : null;
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [Text(label, style: style), Text(value, style: style)],
    ),
  );
}

String _formatDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
}

String _trimZero(num v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();
