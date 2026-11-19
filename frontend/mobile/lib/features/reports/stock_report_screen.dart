import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_filter_chip.dart';
import 'laporan_rinci_screen.dart' show ymd;
import 'stock_report_view.dart';

/// Laporan Stok untuk gudang (pencocokan fisik): stok awal, masuk, keluar, dan sisa per barang tanpa angka uang.
/// Padanan `/stock/laporan` di web. Admin memakai tab Stok di Laporan Rinci.
class StockReportScreen extends StatefulWidget {
  const StockReportScreen({super.key});

  @override
  State<StockReportScreen> createState() => _StockReportScreenState();
}

class _StockReportScreenState extends State<StockReportScreen> {
  late DateTime _from = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _to = DateTime.now();

  bool get _valid => !_from.isAfter(_to);

  void _preset(int days) => setState(() {
        _to = DateTime.now();
        _from = _to.subtract(Duration(days: days - 1));
      });

  Future<void> _pick(bool isFrom) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? _from : _to,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) setState(() => isFrom ? _from = picked : _to = picked);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Laporan Stok')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
          child: Column(children: [
            Row(children: [
              Expanded(
                child: OutlinedButton(
                  key: const Key('stock-from'),
                  onPressed: () => _pick(true),
                  child: Text('Dari ${ymd(_from)}'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  key: const Key('stock-to'),
                  onPressed: () => _pick(false),
                  child: Text('Sampai ${ymd(_to)}'),
                ),
              ),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              AppFilterChip(label: '7 hari', selected: false, onTap: () => _preset(7)),
              const SizedBox(width: 8),
              AppFilterChip(label: '30 hari', selected: false, onTap: () => _preset(30)),
            ]),
            if (!_valid)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('Tanggal awal harus sebelum tanggal akhir.',
                    style: TextStyle(color: AppColors.danger, fontSize: 12)),
              ),
          ]),
        ),
        Expanded(
          child: _valid
              ? StockReportView(range: (from: ymd(_from), to: ymd(_to)))
              : const SizedBox.shrink(),
        ),
      ]),
    );
  }
}
