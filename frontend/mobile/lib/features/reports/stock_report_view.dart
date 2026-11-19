import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import 'laporan_rinci_screen.dart' show Range, stockReportProvider;
import 'stock_report_logic.dart';
import 'stock_report_pdf.dart';

String _num(num n) => n == n.roundToDouble() ? '${n.round()}' : '$n';

/// Isi Laporan Stok untuk satu rentang tanggal (cerminan `/stock/laporan` dan tab Stok `/laporan` di web): stok awal,
/// masuk, keluar, dan sisa per barang, dikelompokkan per merk. Admin juga melihat modal/omzet/untung; role gudang tidak
/// (server membuangnya). Dipakai di tab Stok Laporan Rinci dan di layar Laporan Stok gudang.
class StockReportView extends ConsumerStatefulWidget {
  const StockReportView({super.key, required this.range});

  final Range range;

  @override
  ConsumerState<StockReportView> createState() => _StockReportViewState();
}

class _StockReportViewState extends ConsumerState<StockReportView> {
  String _kind = 'all';
  String? _brand; // null = semua merk
  bool _showEmpty = false;
  bool _busy = false;

  Future<void> _print(List<StockGroup> groups, int hidden, StockReportData data) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await Printing.layoutPdf(
        name: 'Laporan-Stok-${widget.range.from}-${widget.range.to}',
        onLayout: (_) => buildStockReportPdf(
          groups,
          from: widget.range.from,
          to: widget.range.to,
          showMoney: data.hasMoney,
          hidden: hidden,
          summary: data.hasMoney ? (modal: data.modal, omzet: data.omzet, untung: data.untung) : null,
        ),
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final key = (widget.range, _kind);
    return ref.watch(stockReportProvider(key)).when(
          loading: () => const AppSkeletonDetail(),
          error: (e, _) => AppErrorState(
            error: e,
            title: 'Gagal memuat laporan stok',
            onRetry: () => ref.invalidate(stockReportProvider(key)),
          ),
          data: (report) {
            final all = [for (final j in report.items) StockMovementRow.fromJson(j)];
            final brands = [for (final g in groupStockRows(all)) g.label];
            final brand = brands.contains(_brand) ? _brand : null;
            final sel = selectStockGroups(all, brand: brand, showEmpty: _showEmpty);
            final data = StockReportData(report.hasMoney, report.modal, report.omzet, report.untung);
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              children: [
                Row(children: [
                  for (final (v, l) in const [('all', 'Semua'), ('product', 'Produk'), ('sparepart', 'Sparepart')]) ...[
                    AppFilterChip(label: l, selected: _kind == v, onTap: () => setState(() => _kind = v)),
                    const SizedBox(width: 8),
                  ],
                ]),
                const SizedBox(height: 8),
                DropdownButtonFormField<String?>(
                  // Key ikut merk supaya pilihan ikut direset bila merk hilang dari daftar (ganti jenis).
                  key: ValueKey('stock-brand-$brand'),
                  initialValue: brand,
                  decoration: const InputDecoration(labelText: 'Merk'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Semua merk')),
                    for (final b in brands) DropdownMenuItem(value: b, child: Text(b)),
                  ],
                  onChanged: (v) => setState(() => _brand = v),
                ),
                CheckboxListTile(
                  key: const Key('stock-show-empty'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  title: const Text('Tampilkan juga barang tanpa stok'),
                  value: _showEmpty,
                  onChanged: (v) => setState(() => _showEmpty = v ?? false),
                ),
                OutlinedButton.icon(
                  key: const Key('stock-print'),
                  onPressed: _busy || sel.groups.isEmpty ? null : () => _print(sel.groups, sel.hidden, data),
                  icon: const Icon(Icons.print_outlined),
                  label: const Text('Cetak PDF'),
                ),
                if (data.hasMoney) ...[
                  const SizedBox(height: 12),
                  _MoneySummary(data),
                ],
                const SizedBox(height: 8),
                Text(
                  'Indoor dan Outdoor yang berpasangan ditandai garis di kiri dan dihitung sebagai satu set.'
                  '${sel.hidden > 0 ? ' ${sel.hidden} barang tanpa stok disembunyikan.' : ''}',
                  style: const TextStyle(fontSize: 12, color: AppColors.slate600),
                ),
                const SizedBox(height: 8),
                if (sel.groups.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 32),
                    child: Center(
                      child: Text(
                        sel.hidden == 0
                            ? 'Tidak ada item.'
                            : 'Belum ada barang yang punya stok. Centang "Tampilkan juga barang tanpa stok" untuk melihat semuanya.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.slate500),
                      ),
                    ),
                  ),
                for (final g in sel.groups) _GroupSection(g, showMoney: data.hasMoney),
              ],
            );
          },
        );
  }
}

/// Ringkasan `StockReport` yang dibutuhkan tombol cetak.
class StockReportData {
  const StockReportData(this.hasMoney, this.modal, this.omzet, this.untung);
  final bool hasMoney;
  final num modal;
  final num omzet;
  final num untung;
}

class _MoneySummary extends StatelessWidget {
  const _MoneySummary(this.data);
  final StockReportData data;

  @override
  Widget build(BuildContext context) {
    Widget line(String l, num v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(children: [
            Expanded(child: Text(l, style: const TextStyle(color: AppColors.slate600))),
            Text(formatRupiahNum(v), style: const TextStyle(fontWeight: FontWeight.w600)),
          ]),
        );
    return Column(children: [
      line('Modal Tersisa', data.modal),
      line('Omzet Terjual', data.omzet),
      line('Untung Terjual', data.untung),
    ]);
  }
}

class _GroupSection extends StatelessWidget {
  const _GroupSection(this.group, {required this.showMoney});
  final StockGroup group;
  final bool showMoney;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        color: AppColors.slate100,
        child: Row(children: [
          Expanded(
            child: Text.rich(TextSpan(children: [
              TextSpan(text: group.label, style: const TextStyle(fontWeight: FontWeight.w700)),
              TextSpan(
                text: '  ${group.rows.length} item',
                style: const TextStyle(fontSize: 12, color: AppColors.slate600),
              ),
            ])),
          ),
          // Sparepart tidak dijumlah: satuannya campur.
          if (group.label != sparepartGroup)
            Text(_num(group.totalSisa), style: const TextStyle(fontWeight: FontWeight.w700)),
        ]),
      ),
      for (final (i, r) in group.rows.indexed)
        _RowTile(r, outdoorOfPackage: isPackageOutdoor(group.rows, i), showMoney: showMoney),
    ]);
  }
}

class _RowTile extends StatelessWidget {
  const _RowTile(this.row, {required this.outdoorOfPackage, required this.showMoney});
  final StockMovementRow row;
  final bool outdoorOfPackage;
  final bool showMoney;

  @override
  Widget build(BuildContext context) {
    final inPackage = outdoorOfPackage || row.pairName != null;
    const small = TextStyle(fontSize: 12, color: AppColors.slate600);
    return Container(
      padding: EdgeInsets.fromLTRB(outdoorOfPackage ? 24 : 12, 8, 12, 8),
      decoration: BoxDecoration(
        border: Border(
          left: inPackage ? const BorderSide(color: AppColors.teal500, width: 3) : BorderSide.none,
          bottom: const BorderSide(color: AppColors.slate200),
        ),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              '${outdoorOfPackage ? '↳ ' : ''}${row.name}',
              style: const TextStyle(fontWeight: FontWeight.w500),
            ),
            if (row.pairRole != null) Text(row.jenisLabel, style: small),
            if (row.pairSisa != null) Text('Set lengkap siap jual: ${_num(row.pairSisa!)}', style: small),
            const SizedBox(height: 2),
            Text(
              'Awal ${_num(row.stokAwal)} · Masuk ${_num(row.stokMasuk)} · Keluar ${_num(row.stokKeluar)}',
              style: small,
            ),
            if (showMoney)
              Text(
                'Modal ${formatRupiahNum(row.modalTersisa ?? 0)} · Omzet ${formatRupiahNum(row.omzetTerjual ?? 0)} · '
                'Untung ${formatRupiahNum(row.untungTerjual ?? 0)}',
                style: small,
              ),
          ]),
        ),
        const SizedBox(width: 8),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(_num(row.sisaStok), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          Text(row.unit.isEmpty ? 'sisa' : row.unit, style: small),
        ]),
      ]),
    );
  }
}
