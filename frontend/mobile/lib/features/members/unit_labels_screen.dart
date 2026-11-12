import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../core/api/api_client.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/num_parse.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../data/models/ac_unit.dart';
import '../../data/models/app_user.dart';
import 'unit_label_pdf.dart';

// Label QR unit AC (admin; tab Label di Input Data Lampau web): daftar unit beserta status cetak/tempel label,
// cetak massal (maks 100 label sekali cetak) dan tandai sudah ditempel.
// GET /unit-labels, POST /unit-labels/mark-printed, POST /unit-labels/mark-attached.

const maxLabelsPerPrint = 100;

const labelFilterOptions = {
  'belum_ditempel': 'Belum ditempel',
  'belum_dicetak': 'Belum dicetak',
  'sudah_ditempel': 'Sudah ditempel',
  'semua': 'Semua',
};

const labelDataOptions = {
  'semua': 'Semua data',
  'menunggu_data': 'Menunggu data teknisi',
  'aktif': 'Data lengkap',
};

class LabelRow {
  LabelRow(Map<String, dynamic> j)
      : id = '${j['id']}',
        barcode = '${j['barcodeValue']}',
        status = '${j['status']}',
        brand = (j['brand'] as String?) ?? '',
        model = (j['model'] as String?) ?? '',
        pk = (numFromNest(j['pk']) ?? 0).toDouble(),
        room = (j['roomLocation'] as String?) ?? '',
        printedAt = j['labelPrintedAt'] as String?,
        attachedAt = j['labelAttachedAt'] as String?,
        memberId = '${(j['member'] as Map?)?['id']}',
        memberName = ((j['member'] as Map?)?['name'] as String?) ?? '-',
        memberAddress = ((j['member'] as Map?)?['address'] as String?) ?? '';
  final String id;
  final String barcode;
  final String status;
  final String brand;
  final String model;
  final double pk;
  final String room;
  final String? printedAt;
  final String? attachedAt;
  final String memberId;
  final String memberName;
  final String memberAddress;

  bool get waitingData => status == 'menunggu_data';

  AcUnit toUnit() => AcUnit(
        id: id,
        memberId: memberId,
        brand: brand,
        model: model,
        pk: pk,
        roomLocation: room,
        barcodeValue: barcode,
      );

  /// Unit "QR dulu" belum punya tipe: labelnya memuat nama + alamat member supaya tetap bisa dikenali.
  List<String> get extraLines =>
      waitingData ? [memberName, if (memberAddress.isNotEmpty) memberAddress] : const [];

  String get labelState => attachedAt != null ? 'Sudah ditempel' : (printedAt != null ? 'Sudah dicetak' : 'Belum dicetak');
}

class LabelList {
  LabelList(Map<String, dynamic> j)
      : belumDicetak = numFromNest((j['counts'] as Map?)?['belumDicetak'])?.toInt() ?? 0,
        belumDitempel = numFromNest((j['counts'] as Map?)?['belumDitempel'])?.toInt() ?? 0,
        menungguData = numFromNest((j['counts'] as Map?)?['menungguData'])?.toInt() ?? 0,
        total = numFromNest(j['total'])?.toInt() ?? 0,
        items = [for (final e in (j['items'] as List? ?? const [])) LabelRow(Map<String, dynamic>.from(e as Map))];
  final int belumDicetak;
  final int belumDitempel;
  final int menungguData;
  final int total;
  final List<LabelRow> items;
}

typedef LabelQuery = ({String label, String data, String q, int pageSize});

final unitLabelsProvider = FutureProvider.autoDispose.family<LabelList, LabelQuery>((ref, k) async {
  final params = {'label': k.label, 'data': k.data, 'page': '1', 'pageSize': '${k.pageSize}', if (k.q.isNotEmpty) 'q': k.q};
  final r = await const ApiClient().get('/unit-labels?${Uri(queryParameters: params).query}');
  return LabelList(Map<String, dynamic>.from(r as Map));
});

/// Penanda label: `POST /unit-labels/mark-printed|mark-attached` dengan `{ids}`.
final markLabelsProvider = Provider<Future<void> Function(List<String> ids, {required bool attached})>((ref) {
  return (ids, {required attached}) async {
    await const ApiClient().post('/unit-labels/${attached ? 'mark-attached' : 'mark-printed'}', body: {'ids': ids});
  };
});

/// Cetak label sebagai satu dokumen; hasil `true` bila pengguna benar-benar mencetak/menyimpan.
final printLabelsProvider = Provider<Future<bool> Function(List<LabelRow> rows)>((ref) {
  return (rows) => Printing.layoutPdf(
        name: 'Label-QR-${rows.length}',
        onLayout: (_) => buildUnitLabelsPdf(
          [for (final r in rows) r.toUnit()],
          extraLines: {for (final r in rows) if (r.extraLines.isNotEmpty) r.id: r.extraLines},
        ),
      );
});

class UnitLabelsScreen extends ConsumerStatefulWidget {
  const UnitLabelsScreen({super.key});

  @override
  ConsumerState<UnitLabelsScreen> createState() => _UnitLabelsScreenState();
}

class _UnitLabelsScreenState extends ConsumerState<UnitLabelsScreen> {
  String _label = 'belum_ditempel';
  String _data = 'semua';
  String _q = '';
  int _pageSize = 20;
  final _picked = <String>{};
  bool _busy = false;

  LabelQuery get _key => (label: _label, data: _data, q: _q, pageSize: _pageSize);

  Future<void> _print(List<LabelRow> shown) async {
    final rows = [for (final r in shown) if (_picked.contains(r.id)) r];
    if (rows.isEmpty || rows.length > maxLabelsPerPrint) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final printed = await ref.read(printLabelsProvider)(rows);
      if (printed) {
        await ref.read(markLabelsProvider)([for (final r in rows) r.id], attached: false);
        messenger.showSnackBar(SnackBar(content: Text('${rows.length} label dicetak dan ditandai.')));
        ref.invalidate(unitLabelsProvider(_key));
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _attach() async {
    final ids = _picked.toList();
    if (ids.isEmpty) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(markLabelsProvider)(ids, attached: true);
      messenger.showSnackBar(const SnackBar(content: Text('Ditandai sudah ditempel.')));
      setState(_picked.clear);
      ref.invalidate(unitLabelsProvider(_key));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(unitLabelsProvider(_key));
    final admin = ref.watch(currentUserProvider).value?.role == UserRole.admin;
    final data = async.asData?.value;
    return Scaffold(
      appBar: AppBar(title: const Text('Label QR')),
      body: Column(children: [
        if (data != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Text(
              'Belum dicetak ${data.belumDicetak} · Belum ditempel ${data.belumDitempel} · Menunggu data ${data.menungguData}',
              key: const Key('label-counts'),
              style: const TextStyle(fontSize: 12, color: AppColors.slate600),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: TextField(
            key: const Key('label-search'),
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Cari member / alamat / ruangan / kode', isDense: true),
            onSubmitted: (v) => setState(() {
              _q = v.trim();
              _pageSize = 20;
            }),
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [
            for (final e in labelFilterOptions.entries) ...[
              AppFilterChip(label: e.value, selected: _label == e.key, onTap: () => setState(() => _label = e.key)),
              const SizedBox(width: 8),
            ],
          ]),
        ),
        const SizedBox(height: 6),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [
            for (final e in labelDataOptions.entries) ...[
              AppFilterChip(label: e.value, selected: _data == e.key, onTap: () => setState(() => _data = e.key)),
              const SizedBox(width: 8),
            ],
          ]),
        ),
        Expanded(
          child: async.when(
            loading: () => const AppSkeletonList(),
            error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat label', onRetry: () => ref.invalidate(unitLabelsProvider(_key))),
            data: (d) => d.items.isEmpty
                ? const AppEmptyState(icon: Icons.qr_code_2, title: 'Tidak ada unit', message: 'Ubah filter atau kata kunci.')
                : ListView(padding: const EdgeInsets.fromLTRB(8, 4, 8, 16), children: [
                    CheckboxListTile(
                      key: const Key('label-pick-all'),
                      dense: true,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: const Text('Pilih semua di halaman'),
                      value: d.items.every((r) => _picked.contains(r.id)),
                      onChanged: (v) => setState(() {
                        for (final r in d.items) {
                          v == true ? _picked.add(r.id) : _picked.remove(r.id);
                        }
                      }),
                    ),
                    for (final r in d.items)
                      CheckboxListTile(
                        key: Key('label-row-${r.id}'),
                        dense: true,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: _picked.contains(r.id),
                        onChanged: (v) => setState(() => v == true ? _picked.add(r.id) : _picked.remove(r.id)),
                        title: Text(r.memberName, style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text([
                          r.barcode,
                          r.waitingData ? 'menunggu data teknisi' : '${r.brand} ${r.model}'.trim(),
                          if (r.room.isNotEmpty) r.room,
                          r.labelState,
                        ].join(' · ')),
                      ),
                    if (d.items.length < d.total && _pageSize < 100)
                      TextButton(
                        key: const Key('label-more'),
                        onPressed: () => setState(() => _pageSize = (_pageSize + 20).clamp(20, 100)),
                        child: Text('Muat lebih banyak (${d.items.length}/${d.total})'),
                      ),
                  ]),
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (_picked.length > maxLabelsPerPrint)
                const Text('Maksimal 100 label sekali cetak.', style: TextStyle(color: AppColors.danger, fontSize: 12)),
              Row(children: [
                Expanded(
                  child: FilledButton.icon(
                    key: const Key('label-print'),
                    onPressed: _busy || _picked.isEmpty || _picked.length > maxLabelsPerPrint || data == null ? null : () => _print(data.items),
                    icon: const Icon(Icons.print_outlined),
                    label: Text('Cetak (${_picked.length})'),
                  ),
                ),
                if (admin) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      key: const Key('label-attach'),
                      onPressed: _busy || _picked.isEmpty ? null : _attach,
                      icon: const Icon(Icons.done_all),
                      label: const Text('Sudah ditempel'),
                    ),
                  ),
                ],
              ]),
            ]),
          ),
        ),
      ]),
    );
  }
}
