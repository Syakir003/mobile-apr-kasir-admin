import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/utils/num_parse.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../data/models/technician_job.dart' show JobStatus;

// Laporan rinci (admin) dengan rentang tanggal bebas, padanan halaman web /laporan: Penjualan, Servis, Laba-Rugi, Stok.
// Endpoint: GET /reports/{sales,service,profit-loss,stock-movements}?from=&to= (angka sudah number dari server).

typedef Range = ({String from, String to});

String ymd(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)}';
}

num _n(Object? v) => numFromNest(v) ?? 0;
List<Map<String, dynamic>> _list(Object? v) =>
    [for (final e in (v as List? ?? const [])) Map<String, dynamic>.from(e as Map)];

// ---------- Penjualan ----------
class DayPoint {
  const DayPoint(this.date, this.total, this.count);
  final String date;
  final num total;
  final int count;
}

class WeekBar {
  const WeekBar(this.start, this.total, this.count);
  final String start; // Senin, YYYY-MM-DD
  final num total;
  final int count;
}

/// Gabungkan data harian jadi per minggu (Senin–Minggu); minggu kosong di antara yang terisi tetap tampil 0
/// (padanan groupByWeek di web).
List<WeekBar> groupByWeek(List<DayPoint> days) {
  if (days.isEmpty) return const [];
  const day = Duration(days: 1);
  DateTime mondayOf(String date) {
    final t = DateTime.parse('${date.substring(0, 10)}T00:00:00Z');
    return t.subtract(Duration(days: (t.weekday + 6) % 7));
  }

  final byWeek = <DateTime, (num, int)>{};
  for (final d in days) {
    final m = mondayOf(d.date);
    final cur = byWeek[m] ?? (0, 0);
    byWeek[m] = (cur.$1 + d.total, cur.$2 + d.count);
  }
  final keys = byWeek.keys.toList()..sort();
  final out = <WeekBar>[];
  for (var m = keys.first; !m.isAfter(keys.last); m = m.add(day * 7)) {
    final v = byWeek[m] ?? (0, 0);
    out.add(WeekBar(ymd(m), v.$1, v.$2));
  }
  return out;
}

const tierLabel = {'retail': 'Ritel', 'installer': 'Installer', 'reseller': 'Reseller'};

class SalesReport {
  SalesReport(Map<String, dynamic> j)
      : totalPenjualan = _n(j['totalPenjualan']),
        totalInvoice = _n(j['totalInvoice']).toInt(),
        totalDiskon = _n(j['totalDiskon']),
        totalPajak = _n(j['totalPajak']),
        kategori = [for (final k in _list(j['breakdownKategori'])) ('${k['category']}', _n(k['totalLine']), _n(k['qty']))],
        harian = [for (final d in _list(j['grafikHarian'])) DayPoint('${d['date']}', _n(d['total']), _n(d['count']).toInt())],
        tipe = [for (final t in _list(j['perTipePembeli'])) ('${t['tier']}', _n(t['total']), _n(t['count']).toInt())];
  final num totalPenjualan;
  final int totalInvoice;
  final num totalDiskon;
  final num totalPajak;
  final List<(String, num, num)> kategori;
  final List<DayPoint> harian;
  final List<(String, num, int)> tipe;
}

class ServiceReport {
  ServiceReport(Map<String, dynamic> j)
      : perStatus = [for (final s in _list(j['jumlahPerStatus'])) ('${s['status']}', _n(s['count']).toInt())],
        rataMenit = j['rataRataWaktuPengerjaanMenit'] == null ? null : _n(j['rataRataWaktuPengerjaanMenit']),
        teknisi = [for (final t in _list(j['performaTeknisi'])) ('${t['namaTeknisi']}', _n(t['jobSelesai']).toInt())];
  final List<(String, int)> perStatus;
  final num? rataMenit;
  final List<(String, int)> teknisi;
}

class ProfitLossReport {
  ProfitLossReport(Map<String, dynamic> j)
      : pendapatan = _n((j['ringkasan'] as Map?)?['totalPendapatan']),
        hpp = _n((j['ringkasan'] as Map?)?['totalHpp']),
        labaKotor = _n((j['ringkasan'] as Map?)?['labaKotor']),
        margin = _n((j['ringkasan'] as Map?)?['marginPersen']),
        barisTanpaModal = _n((j['ringkasan'] as Map?)?['barisJualSatuanTanpaModal']).toInt(),
        labaKotorTerendah = _n((j['ringkasan'] as Map?)?['labaKotorTerendah']),
        modalTakTeralokasiMaks = _n((j['ringkasan'] as Map?)?['modalPaketTakTeralokasiMaks']),
        detail = _list(j['detailPerItem']);
  final num pendapatan;
  final num hpp;
  final num labaKotor;
  final num margin;
  final int barisTanpaModal;
  final num labaKotorTerendah;
  final num modalTakTeralokasiMaks;
  final List<Map<String, dynamic>> detail;
}

class StockReport {
  StockReport(Map<String, dynamic> j)
      : items = _list(j['items']),
        modal = _n((j['ringkasan'] as Map?)?['totalModalTersisa']),
        omzet = _n((j['ringkasan'] as Map?)?['totalOmzetTerjual']),
        untung = _n((j['ringkasan'] as Map?)?['totalUntungTerjual']);
  final List<Map<String, dynamic>> items;
  final num modal;
  final num omzet;
  final num untung;
}

Future<Map<String, dynamic>> _get(String path) async =>
    Map<String, dynamic>.from(await const ApiClient().get(path) as Map);

final salesReportProvider = FutureProvider.autoDispose.family<SalesReport, Range>(
    (ref, r) async => SalesReport(await _get('/reports/sales?from=${r.from}&to=${r.to}')));
final serviceReportProvider = FutureProvider.autoDispose.family<ServiceReport, Range>(
    (ref, r) async => ServiceReport(await _get('/reports/service?from=${r.from}&to=${r.to}')));
final profitLossReportProvider = FutureProvider.autoDispose.family<ProfitLossReport, Range>(
    (ref, r) async => ProfitLossReport(await _get('/reports/profit-loss?from=${r.from}&to=${r.to}')));

/// [kind] = 'all' | 'product' | 'sparepart'.
final stockReportProvider = FutureProvider.autoDispose.family<StockReport, (Range, String)>((ref, k) async {
  final (r, kind) = k;
  return StockReport(await _get(
      '/reports/stock-movements?from=${r.from}&to=${r.to}${kind == 'all' ? '' : '&kind=$kind'}'));
});

// ---------- Layar ----------
class LaporanRinciScreen extends ConsumerStatefulWidget {
  const LaporanRinciScreen({super.key});

  @override
  ConsumerState<LaporanRinciScreen> createState() => _LaporanRinciScreenState();
}

class _LaporanRinciScreenState extends ConsumerState<LaporanRinciScreen> {
  late DateTime _from = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _to = DateTime.now();

  Range get _range => (from: ymd(_from), to: ymd(_to));
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
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Laporan Rinci'),
          bottom: const TabBar(
            tabs: [Tab(text: 'Penjualan'), Tab(text: 'Servis'), Tab(text: 'Laba-Rugi'), Tab(text: 'Stok')],
          ),
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
              child: Column(
                children: [
                  Row(children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('rinci-from'),
                        onPressed: () => _pick(true),
                        child: Text('Dari ${ymd(_from)}'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('rinci-to'),
                        onPressed: () => _pick(false),
                        child: Text('Sampai ${ymd(_to)}'),
                      ),
                    ),
                  ]),
                  const SizedBox(height: 8),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(children: [
                      AppFilterChip(label: 'Hari ini', selected: false, onTap: () => _preset(1)),
                      const SizedBox(width: 8),
                      AppFilterChip(label: '7 hari', selected: false, onTap: () => _preset(7)),
                      const SizedBox(width: 8),
                      AppFilterChip(label: '30 hari', selected: false, onTap: () => _preset(30)),
                      const SizedBox(width: 8),
                      AppFilterChip(
                        label: 'Bulan ini',
                        selected: false,
                        onTap: () => setState(() {
                          _to = DateTime.now();
                          _from = DateTime(_to.year, _to.month, 1);
                        }),
                      ),
                    ]),
                  ),
                  if (!_valid)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text('Tanggal awal harus sebelum tanggal akhir.',
                          style: TextStyle(color: AppColors.danger, fontSize: 12)),
                    ),
                ],
              ),
            ),
            Expanded(
              child: !_valid
                  ? const SizedBox.shrink()
                  : TabBarView(
                      children: [
                        _SalesTab(range: _range),
                        _ServiceTab(range: _range),
                        _ProfitTab(range: _range),
                        _StockTab(range: _range),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Pembungkus async: loading skeleton, galat dengan Coba Lagi, atau isi.
class _Async<T> extends StatelessWidget {
  const _Async({required this.value, required this.onRetry, required this.builder});
  final AsyncValue<T> value;
  final VoidCallback onRetry;
  final Widget Function(T) builder;

  @override
  Widget build(BuildContext context) => value.when(
        loading: () => const AppSkeletonDetail(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat laporan', onRetry: onRetry),
        data: builder,
      );
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value, {this.color});
  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) => Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(fontSize: 12, color: AppColors.slate600)),
              const SizedBox(height: 4),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: color)),
              ),
            ],
          ),
        ),
      );
}

Widget _grid(List<Widget> stats) => GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 2.4,
      children: stats,
    );

class _Section extends StatelessWidget {
  const _Section(this.title, this.children);
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.slate900)),
              const SizedBox(height: 8),
              if (children.isEmpty) const Text('Tidak ada data.', style: TextStyle(color: AppColors.slate600)),
              ...children,
            ],
          ),
        ),
      );
}

Widget _kv(String k, String v, {bool bold = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(children: [
        Expanded(child: Text(k)),
        Text(v, style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w500)),
      ]),
    );

class _SalesTab extends ConsumerWidget {
  const _SalesTab({required this.range});
  final Range range;

  @override
  Widget build(BuildContext context, WidgetRef ref) => _Async<SalesReport>(
        value: ref.watch(salesReportProvider(range)),
        onRetry: () => ref.invalidate(salesReportProvider(range)),
        builder: (s) {
          final weeks = groupByWeek(s.harian);
          final maxW = weeks.fold<num>(1, (m, w) => w.total > m ? w.total : m);
          return ListView(padding: const EdgeInsets.all(16), children: [
            _grid([
              _Stat('Total Penjualan', formatRupiahNum(s.totalPenjualan)),
              _Stat('Jumlah Invoice', '${s.totalInvoice}'),
              _Stat('Total Diskon', formatRupiahNum(s.totalDiskon)),
              _Stat('Total Pajak', formatRupiahNum(s.totalPajak)),
            ]),
            const SizedBox(height: 12),
            _Section('Grafik Mingguan', [
              for (final w in weeks)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('Minggu ${w.start}', style: const TextStyle(fontSize: 12))),
                      Text('${formatRupiahNum(w.total)} · ${w.count} inv', style: const TextStyle(fontSize: 12)),
                    ]),
                    const SizedBox(height: 3),
                    LinearProgressIndicator(value: (w.total / maxW).toDouble(), minHeight: 6),
                  ]),
                ),
            ]),
            const SizedBox(height: 12),
            _Section('Penjualan per Tipe Pembeli', [
              for (final t in s.tipe) _kv('${tierLabel[t.$1] ?? t.$1} (${t.$3})', formatRupiahNum(t.$2)),
            ]),
            const SizedBox(height: 12),
            _Section('Breakdown per Kategori', [
              for (final k in s.kategori) _kv('${k.$1} (${k.$3.round()})', formatRupiahNum(k.$2)),
            ]),
          ]);
        },
      );
}

class _ServiceTab extends ConsumerWidget {
  const _ServiceTab({required this.range});
  final Range range;

  @override
  Widget build(BuildContext context, WidgetRef ref) => _Async<ServiceReport>(
        value: ref.watch(serviceReportProvider(range)),
        onRetry: () => ref.invalidate(serviceReportProvider(range)),
        builder: (s) => ListView(padding: const EdgeInsets.all(16), children: [
          _grid([
            _Stat('Rata-rata Pengerjaan', s.rataMenit == null ? '-' : '${s.rataMenit!.round()} menit'),
            _Stat('Total Job', '${s.perStatus.fold<int>(0, (t, e) => t + e.$2)}'),
          ]),
          const SizedBox(height: 12),
          _Section('Job per Status', [
            for (final e in s.perStatus) _kv(JobStatus.fromValue(e.$1).label, '${e.$2}'),
          ]),
          const SizedBox(height: 12),
          _Section('Performa Teknisi (job selesai)', [
            for (final t in s.teknisi) _kv(t.$1, '${t.$2}'),
          ]),
        ]),
      );
}

class _ProfitTab extends ConsumerWidget {
  const _ProfitTab({required this.range});
  final Range range;

  @override
  Widget build(BuildContext context, WidgetRef ref) => _Async<ProfitLossReport>(
        value: ref.watch(profitLossReportProvider(range)),
        onRetry: () => ref.invalidate(profitLossReportProvider(range)),
        builder: (p) => ListView(padding: const EdgeInsets.all(16), children: [
          _grid([
            _Stat('Total Pendapatan', formatRupiahNum(p.pendapatan)),
            _Stat('Total HPP', formatRupiahNum(p.hpp)),
            _Stat('Laba Kotor', formatRupiahNum(p.labaKotor), color: p.labaKotor < 0 ? AppColors.danger : null),
            _Stat('Margin', '${p.margin}%'),
          ]),
          if (p.barisTanpaModal > 0) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: AppColors.warning.withValues(alpha: 0.4)),
              ),
              child: Text(
                'Ada ${p.barisTanpaModal} baris penjualan satuan (Indoor/Outdoor saja) yang modalnya belum dialokasikan, '
                'jadi Laba Kotor masih optimis.'
                '${p.modalTakTeralokasiMaks > 0 ? ' Laba kotor sebenarnya antara ${formatRupiahNum(p.labaKotorTerendah)} dan ${formatRupiahNum(p.labaKotor)}.' : ''}',
                style: const TextStyle(fontSize: 12),
              ),
            ),
          ],
          const SizedBox(height: 12),
          _Section('Detail per Item', [
            for (final d in p.detail)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${d['name']}', style: const TextStyle(fontWeight: FontWeight.w500)),
                  Text(
                    'Terjual ${_n(d['qtyTerjual'])} · Pendapatan ${formatRupiahNum(_n(d['revenue']))} · HPP ${formatRupiahNum(_n(d['hpp']))}',
                    style: const TextStyle(fontSize: 12, color: AppColors.slate600),
                  ),
                  if ('${d['catatan'] ?? ''}'.isNotEmpty)
                    Text('${d['catatan']}', style: const TextStyle(fontSize: 11, color: AppColors.slate500)),
                ]),
              ),
          ]),
        ]),
      );
}

class _StockTab extends ConsumerStatefulWidget {
  const _StockTab({required this.range});
  final Range range;

  @override
  ConsumerState<_StockTab> createState() => _StockTabState();
}

class _StockTabState extends ConsumerState<_StockTab> {
  String _kind = 'all';

  @override
  Widget build(BuildContext context) {
    final key = (widget.range, _kind);
    return _Async<StockReport>(
      value: ref.watch(stockReportProvider(key)),
      onRetry: () => ref.invalidate(stockReportProvider(key)),
      builder: (s) => ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [
          for (final (v, l) in const [('all', 'Semua'), ('product', 'Produk'), ('sparepart', 'Sparepart')]) ...[
            AppFilterChip(label: l, selected: _kind == v, onTap: () => setState(() => _kind = v)),
            const SizedBox(width: 8),
          ],
        ]),
        const SizedBox(height: 12),
        _grid([
          _Stat('Modal Tersisa', formatRupiahNum(s.modal)),
          _Stat('Omzet Terjual', formatRupiahNum(s.omzet)),
          _Stat('Untung Terjual', formatRupiahNum(s.untung)),
        ]),
        const SizedBox(height: 12),
        _Section('Pergerakan Stok', [
          for (final r in s.items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w500)),
                Text(
                  'Awal ${_n(r['stokAwal'])} · Masuk ${_n(r['stokMasuk'])} · Keluar ${_n(r['stokKeluar'])} · Sisa ${_n(r['sisaStok'])} ${r['unit'] ?? ''}',
                  style: const TextStyle(fontSize: 12, color: AppColors.slate600),
                ),
              ]),
            ),
        ]),
      ]),
    );
  }
}
