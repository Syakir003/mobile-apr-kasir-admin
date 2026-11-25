import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../data/models/technician_job.dart';
import 'job_list_logic.dart';
import 'job_list_pdf.dart';
import 'job_providers.dart';

/// Cetak Daftar Pekerjaan Servis (admin/kasir). Nilai awal filter dibawa dari layar Job Teknisi lewat query rute
/// (`status`, `from`, `to`, `q`); semuanya bisa diubah di sini sebelum mencetak.
class JobListPrintScreen extends ConsumerStatefulWidget {
  const JobListPrintScreen({
    super.key,
    this.initialFrom = '',
    this.initialTo = '',
    this.initialStatus = PrintStatus.aktif,
    this.initialQuery = '',
  });

  final String initialFrom;
  final String initialTo;
  final PrintStatus initialStatus;
  final String initialQuery;

  @override
  ConsumerState<JobListPrintScreen> createState() => _JobListPrintScreenState();
}

class _JobListPrintScreenState extends ConsumerState<JobListPrintScreen> {
  late String _from = widget.initialFrom;
  late String _to = widget.initialTo;
  late PrintStatus _status = widget.initialStatus;
  late final _query = TextEditingController(text: widget.initialQuery);
  bool _busy = false;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _pick(bool isFrom) async {
    final now = DateTime.now();
    final current = isFrom ? _from : _to;
    final d = await showDatePicker(
      context: context,
      initialDate: current.isEmpty ? now : DateTime.parse(current),
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year + 2),
    );
    if (d == null) return;
    setState(() => isFrom ? _from = dayKey(d) : _to = dayKey(d));
  }

  Future<void> _print() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final selected = selectPrintRows(
        ref.read(jobsForCurrentUserProvider).valueOrNull ?? const [],
        from: _from,
        to: _to,
        status: _status,
        query: _query.text,
      );
      await Printing.layoutPdf(
        name: 'Daftar-Pekerjaan-Servis',
        onLayout: (_) => buildJobListPdf(selected, from: _from, to: _to, status: _status, query: _query.text),
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final jobsAsync = ref.watch(jobsForCurrentUserProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Cetak Daftar Pekerjaan')),
      body: jobsAsync.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat job'),
        data: (all) {
          final rows = selectPrintRows(all, from: _from, to: _to, status: _status, query: _query.text);
          final byDay = <String, List<List<TechnicianJob>>>{};
          for (final r in rows) {
            byDay.putIfAbsent(rowDate(r), () => []).add(r);
          }
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(child: _dateButton('Dari tanggal', _from, () => _pick(true), () => setState(() => _from = ''))),
                      const SizedBox(width: 8),
                      Expanded(child: _dateButton('Sampai tanggal', _to, () => _pick(false), () => setState(() => _to = ''))),
                    ]),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, children: [
                      for (final s in PrintStatus.values)
                        AppFilterChip(label: s.label, selected: _status == s, onTap: () => setState(() => _status = s)),
                    ]),
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('print-query'),
                      controller: _query,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        isDense: true,
                        labelText: 'Kata kunci (pelanggan, unit, lokasi)',
                        hintText: 'Opsional',
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Daftar ini tanpa nama teknisi, status, dan harga: hanya apa yang dikerjakan.',
                      style: TextStyle(fontSize: 11.5, color: AppColors.slate500),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: rows.isEmpty
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(24),
                          child: Text(
                            'Tidak ada pekerjaan pada filter ini. Ubah tanggal atau status di atas.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppColors.slate500),
                          ),
                        ),
                      )
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                        children: [
                          for (final e in byDay.entries) ...[
                            Padding(
                              padding: const EdgeInsets.only(top: 8, bottom: 4),
                              child: Text(
                                e.key.isEmpty
                                    ? 'Tanpa jadwal (${e.value.length})'
                                    : '${formatTanggalPanjang(DateTime.parse(e.key))} (${e.value.length})',
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                              ),
                            ),
                            for (final r in e.value) _RowTile(row: r),
                          ],
                        ],
                      ),
              ),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                  child: SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: FilledButton.icon(
                      key: const Key('print-list-submit'),
                      onPressed: rows.isEmpty || _busy ? null : _print,
                      icon: const Icon(Icons.print_outlined),
                      label: Text(_busy ? 'Menyiapkan...' : 'Cetak (${rows.length} pekerjaan)'),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _dateButton(String label, String value, VoidCallback onTap, VoidCallback onClear) => OutlinedButton(
        onPressed: onTap,
        child: Row(
          children: [
            Expanded(
              child: Text(
                value.isEmpty ? label : formatTanggalSingkat(DateTime.parse(value)),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (value.isNotEmpty)
              InkWell(onTap: onClear, child: const Padding(padding: EdgeInsets.all(2), child: Icon(Icons.close, size: 16))),
          ],
        ),
      );
}

class _RowTile extends StatelessWidget {
  const _RowTile({required this.row});
  final List<TechnicianJob> row;

  @override
  Widget build(BuildContext context) {
    final jobs = row;
    final first = jobs.first;
    final units = [for (final j in jobs) unitTypeText(j)];
    final location = jobLocation(first);
    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(first.memberName.isEmpty ? 'Order servis' : first.memberName, style: const TextStyle(fontWeight: FontWeight.w600)),
            Text(
              '${jobs.length > 1 ? '${jobs.length} unit AC' : units.first} • ${first.typeLabel}',
              style: const TextStyle(fontSize: 12.5, color: AppColors.slate600),
            ),
            if (location.isNotEmpty)
              Text(location, style: const TextStyle(fontSize: 12, color: AppColors.slate500), maxLines: 2, overflow: TextOverflow.ellipsis),
          ],
        ),
      ),
    );
  }
}
