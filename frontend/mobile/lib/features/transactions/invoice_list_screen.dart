import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/invoice.dart';
import 'invoice_detail_screen.dart' show statusColor;
import 'invoice_providers.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';

/// Rentang waktu riwayat transaksi.
enum InvoiceRange {
  today('Hari ini'),
  week('7 hari'),
  month('30 hari'),
  all('Semua');

  const InvoiceRange(this.label);
  final String label;

  /// Batas bawah, atau null bila tanpa batas. "Hari ini" dihitung dari tengah
  /// malam waktu lokal — bukan 24 jam terakhir.
  DateTime? since(DateTime now) => switch (this) {
        InvoiceRange.all => null,
        InvoiceRange.today => DateTime(now.year, now.month, now.day),
        InvoiceRange.week => now.subtract(const Duration(days: 7)),
        InvoiceRange.month => now.subtract(const Duration(days: 30)),
      };
}

/// Ringkasan uang untuk sekumpulan invoice.
typedef InvoiceSummary = ({int count, int total, int paid, int outstanding});

/// Hitung ringkasan dari daftar yang SEDANG tampil (bukan seluruh data), supaya
/// angkanya selalu cocok dengan apa yang dilihat pengguna setelah memfilter.
///
/// Invoice `batal` & `refund` tidak dihitung sebagai omzet — keduanya bukan
/// pendapatan, dan menjumlahkannya membuat total tampak lebih besar dari
/// kenyataan.
InvoiceSummary summarizeInvoices(List<Invoice> invoices) {
  var total = 0;
  var paid = 0;
  var outstanding = 0;
  var count = 0;
  for (final inv in invoices) {
    if (inv.status == InvoiceStatus.batal ||
        inv.status == InvoiceStatus.refund) {
      continue;
    }
    count++;
    total += inv.grandTotal;
    paid += inv.totalPaid;
    final sisa = inv.sisa;
    if (sisa > 0) outstanding += sisa;
  }
  return (count: count, total: total, paid: paid, outstanding: outstanding);
}

/// Saring daftar invoice sesuai rentang, status, dan kata kunci.
/// Dipisah dari widget agar bisa diuji tanpa membangun UI.
List<Invoice> filterInvoices(
  List<Invoice> invoices, {
  required InvoiceRange range,
  required InvoiceStatus? status,
  required String search,
  DateTime? now,
}) {
  final since = range.since(now ?? DateTime.now());
  final q = search.trim().toLowerCase();
  return [
    for (final inv in invoices)
      if ((since == null ||
              (inv.createdAt != null && !inv.createdAt!.isBefore(since))) &&
          (status == null || inv.status == status) &&
          (q.isEmpty ||
              inv.number.toLowerCase().contains(q) ||
              inv.customerName.toLowerCase().contains(q) ||
              inv.customerPhone.contains(q)))
        inv,
  ];
}

/// Riwayat transaksi/invoice (100 terakhir). Transaksi dibuat dari `/pos`,
/// jadi layar ini tanpa tombol tambah.
class InvoiceListScreen extends ConsumerStatefulWidget {
  const InvoiceListScreen({super.key});

  @override
  ConsumerState<InvoiceListScreen> createState() => _InvoiceListScreenState();
}

class _InvoiceListScreenState extends ConsumerState<InvoiceListScreen> {
  final _searchController = TextEditingController();
  InvoiceRange _range = InvoiceRange.all;
  InvoiceStatus? _status;
  String _search = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final invoicesAsync = ref.watch(invoicesStreamProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Riwayat')),
      body: invoicesAsync.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e),
        data: (invoices) {
          if (invoices.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.receipt_long_outlined,
                      size: 48, color: AppColors.slate300),
                  SizedBox(height: 12),
                  Text('Belum ada transaksi.',
                      style: TextStyle(color: AppColors.slate500)),
                ],
              ),
            );
          }

          final shown = filterInvoices(
            invoices,
            range: _range,
            status: _status,
            search: _search,
          );
          final summary = summarizeInvoices(shown);

          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: TextField(
                  key: const Key('invoice-search'),
                  controller: _searchController,
                  onChanged: (v) => setState(() => _search = v),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'Cari no. invoice, nama, atau HP…',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    suffixIcon: _search.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            tooltip: 'Hapus pencarian',
                            onPressed: () {
                              _searchController.clear();
                              setState(() => _search = '');
                            },
                          ),
                  ),
                ),
              ),
              AppFilterChipBar(
                key: const Key('invoice-range'),
                children: [
                  for (final r in InvoiceRange.values)
                    AppFilterChip(
                      label: r.label,
                      selected: _range == r,
                      onTap: () => setState(() => _range = r),
                    ),
                ],
              ),
              AppFilterChipBar(
                key: const Key('invoice-status'),
                children: [
                  AppFilterChip(
                    label: 'Semua status',
                    selected: _status == null,
                    onTap: () => setState(() => _status = null),
                  ),
                  for (final s in InvoiceStatus.values)
                    AppFilterChip(
                      label: s.label,
                      selected: _status == s,
                      onTap: () => setState(() => _status = s),
                    ),
                ],
              ),
              _SummaryCard(summary: summary),
              Expanded(
                child: shown.isEmpty
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(32),
                          child: Text(
                            'Tidak ada transaksi yang cocok dengan filter.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppColors.slate500),
                          ),
                        ),
                      )
                    : ListView.separated(
                        key: const Key('invoice-list'),
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                        itemCount: shown.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (_, i) => _InvoiceTile(invoice: shown[i]),
                      ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.summary});

  final InvoiceSummary summary;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
      child: Container(
        key: const Key('invoice-summary'),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
        decoration: BoxDecoration(
          color: AppColors.teal50,
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        child: Row(
          children: [
            _cell('Transaksi', '${summary.count}', AppColors.slate900),
            _cell('Nilai', formatRupiahShort(summary.total), AppColors.teal700),
            _cell('Terbayar', formatRupiahShort(summary.paid),
                AppColors.green600),
            _cell(
              'Piutang',
              formatRupiahShort(summary.outstanding),
              summary.outstanding > 0 ? AppColors.warning : AppColors.slate400,
            ),
          ],
        ),
      ),
    );
  }

  Widget _cell(String label, String value, Color color) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: const TextStyle(
                    fontSize: 10.5, color: AppColors.slate500)),
            const SizedBox(height: 3),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: TextStyle(
                    fontSize: 14, fontWeight: FontWeight.bold, color: color),
              ),
            ),
          ],
        ),
      );
}

class _InvoiceTile extends StatelessWidget {
  const _InvoiceTile({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    final inv = invoice;
    final color = statusColor(inv.status);
    final sisa = inv.sisa;

    return Card(
      child: InkWell(
        key: Key('invoice-${inv.id}'),
        onTap: () => context.go('/transactions/${inv.id}'),
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: [
              Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.slate100,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: const Icon(Icons.receipt_long_outlined,
                        color: AppColors.slate500),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          inv.number,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 15,
                            color: AppColors.slate900,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          inv.customerName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.slate500),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        formatRupiah(inv.grandTotal),
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: AppColors.slate900,
                        ),
                      ),
                      const SizedBox(height: 6),
                      StatusBadge(label: inv.status.label, color: color),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  const Icon(Icons.schedule, size: 13,
                      color: AppColors.slate400),
                  const SizedBox(width: 5),
                  Text(
                    inv.createdAt == null
                        ? 'Tanggal tak tercatat'
                        : formatInvoiceDate(inv.createdAt!),
                    style: const TextStyle(
                        fontSize: 11.5, color: AppColors.slate500),
                  ),
                  // Jumlah item sengaja TIDAK ditampilkan di sini:
                  // `InvoiceRepository.watchAll()` tidak ikut memuat
                  // `invoice_items` (daftar hanya butuh ringkasan), jadi
                  // `inv.items` selalu kosong dan barisnya tak akan pernah
                  // terisi. Jumlah item ada di layar detail.
                  const Spacer(),
                  // Sisa tagihan hanya relevan saat memang ada yang kurang;
                  // menampilkan "Sisa Rp 0" pada invoice lunas cuma bising.
                  if (sisa > 0)
                    Text(
                      'Sisa ${formatRupiah(sisa)}',
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.warning,
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String formatInvoiceDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
}
