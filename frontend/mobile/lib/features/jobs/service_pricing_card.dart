import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/num_parse.dart';
import '../../core/widgets/status_badge.dart';
import '../master/master_providers.dart';
import '../transactions/invoice_providers.dart';
import 'job_providers.dart';

// Kartu "Harga Jasa & Tagihan" di detail job untuk admin/kasir (padanan service-pricing-card.tsx di web):
// harga jasa per job + transport opsional; sparepart yang disetujui ikut ke tagihan yang sama.

const transportStep = 100000;
const transportLevels = [1, 2, 3, 4, 5];
const _free = '';

class PricingLine {
  const PricingLine({this.serviceId, required this.name, required this.qty, required this.unitPrice});
  final String? serviceId;
  final String name;
  final num qty;
  final num unitPrice;
}

class PricingSparepartItem {
  const PricingSparepartItem({required this.name, required this.qty, this.qtyUsed, required this.unitPrice});
  final String name;
  final num qty;
  final num? qtyUsed;
  final num unitPrice;
}

class PricingSparepartRequest {
  const PricingSparepartRequest({required this.amount, required this.used, required this.legacy, required this.items});
  final num amount;
  final bool used;
  final bool legacy;
  final List<PricingSparepartItem> items;
}

class PricingInvoice {
  const PricingInvoice({
    required this.id,
    required this.number,
    required this.status,
    required this.grandTotal,
    required this.totalPaid,
  });
  final String id;
  final String number;
  final String status;
  final num grandTotal;
  final num totalPaid;
}

class ServicePricing {
  const ServicePricing({
    required this.editable,
    required this.priced,
    required this.findingsSentAt,
    required this.invoice,
    required this.lines,
    required this.transportLevel,
    required this.transportMode,
    required this.spareparts,
  });
  final bool editable;
  final bool priced;
  final String? findingsSentAt;
  final PricingInvoice? invoice;
  final List<PricingLine> lines;
  final int transportLevel;
  final String transportMode; // 'individu' | 'dibagi'
  final List<PricingSparepartRequest> spareparts;

  factory ServicePricing.fromJson(Map<String, dynamic> j) {
    final inv = j['invoice'] as Map?;
    final transport = (j['transport'] as Map?) ?? const {};
    final requests = ((j['sparepart'] as Map?)?['requests'] as List?) ?? const [];
    return ServicePricing(
      editable: j['editable'] == true,
      priced: j['priced'] == true,
      findingsSentAt: j['findingsSentAt'] as String?,
      invoice: inv == null
          ? null
          : PricingInvoice(
              id: '${inv['id']}',
              number: '${inv['number']}',
              status: '${inv['status']}',
              grandTotal: numFromNest(inv['grandTotal']) ?? 0,
              totalPaid: numFromNest(inv['totalPaid']) ?? 0,
            ),
      lines: [
        for (final l in (j['lines'] as List? ?? const []))
          PricingLine(
            serviceId: (l as Map)['serviceId'] as String?,
            name: (l['name'] as String?) ?? '',
            qty: numFromNest(l['qty']) ?? 1,
            unitPrice: numFromNest(l['unitPrice']) ?? 0,
          ),
      ],
      transportLevel: numFromNest(transport['level'])?.toInt() ?? 0,
      transportMode: transport['mode'] == 'dibagi' ? 'dibagi' : 'individu',
      spareparts: [
        for (final r in requests)
          PricingSparepartRequest(
            amount: numFromNest((r as Map)['amount']) ?? 0,
            used: r['used'] == true,
            legacy: r['legacy'] == true,
            items: [
              for (final i in (r['items'] as List? ?? const []))
                PricingSparepartItem(
                  name: ((i as Map)['name'] as String?) ?? '',
                  qty: numFromNest(i['qty']) ?? 0,
                  qtyUsed: numFromNest(i['qtyUsed']),
                  unitPrice: numFromNest(i['unitPrice']) ?? 0,
                ),
            ],
          ),
      ],
    );
  }
}

/// Satu baris pratinjau tagihan/struk.
class PreviewLine {
  const PreviewLine(this.name, this.qty, this.unitPrice, this.lineTotal);
  final String name;
  final num qty;
  final num unitPrice;
  final int lineTotal;
}

/// Padanan `buildPreview` di web / JobBillingService di backend: jasa + sparepart (+ transport) -> baris tagihan.
/// 'dibagi' membagi transport rata ke semua baris (sisa pembulatan ke baris pertama); selain itu baris "Biaya transport".
List<PreviewLine> buildPricingPreview(
  List<({String name, num qty, num unitPrice})> services,
  List<({String name, num qty, num unitPrice})> spareparts,
  int transport,
  String mode,
) {
  final base = [
    for (final l in [...services, ...spareparts]) PreviewLine(l.name, l.qty, l.unitPrice, (l.qty * l.unitPrice).round()),
  ];
  if (transport <= 0) return base;
  if (mode == 'dibagi' && base.isNotEmpty) {
    final share = transport ~/ base.length;
    final rem = transport - share * base.length;
    return [
      for (var i = 0; i < base.length; i++)
        () {
          final total = base[i].lineTotal + share + (i == 0 ? rem : 0);
          return PreviewLine(base[i].name, base[i].qty, (total / base[i].qty * 100).round() / 100, total);
        }(),
    ];
  }
  return [...base, PreviewLine('Biaya transport', 1, transport, transport)];
}

final servicePricingProvider = FutureProvider.autoDispose.family<ServicePricing, String>((ref, jobId) async {
  final r = await const ApiClient().get('/technician-jobs/$jobId/service-pricing');
  return ServicePricing.fromJson(Map<String, dynamic>.from(r as Map));
});

/// `PUT /technician-jobs/:id/service-pricing` — kembalikan invoice hasilnya (id, nomor) bila ada.
Future<({String id, String number})?> saveServicePricing(
  String jobId, {
  required List<Map<String, dynamic>> lines,
  required int transportLevel,
  required String transportMode,
}) async {
  final r = await const ApiClient().put('/technician-jobs/$jobId/service-pricing', body: {
    'lines': lines,
    'transportLevel': transportLevel,
    'transportMode': transportMode,
  });
  final inv = r is Map ? r['invoice'] as Map? : null;
  return inv == null ? null : (id: '${inv['id']}', number: '${inv['number']}');
}

class _Row {
  _Row({this.serviceId = _free, String name = '', String qty = '1', String price = ''})
      : name = TextEditingController(text: name),
        qty = TextEditingController(text: qty),
        price = TextEditingController(text: price);
  String serviceId; // '' = jasa lain (ketik nama)
  final TextEditingController name;
  final TextEditingController qty;
  final TextEditingController price;

  num? get qtyValue => num.tryParse(qty.text.trim().replaceAll(',', '.'));
  num? get priceValue => num.tryParse(price.text.trim());
  bool get valid =>
      (serviceId.isNotEmpty || name.text.trim().isNotEmpty) && price.text.trim().isNotEmpty && (qtyValue ?? 0) > 0;
  void dispose() {
    name.dispose();
    qty.dispose();
    price.dispose();
  }
}

class ServicePricingCard extends ConsumerStatefulWidget {
  const ServicePricingCard({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<ServicePricingCard> createState() => _ServicePricingCardState();
}

class _ServicePricingCardState extends ConsumerState<ServicePricingCard> {
  List<_Row> _rows = [];
  int _level = 0;
  String _mode = 'individu';
  bool _hydrated = false;
  bool _saving = false;

  @override
  void dispose() {
    for (final r in _rows) {
      r.dispose();
    }
    super.dispose();
  }

  void _hydrate(ServicePricing d) {
    for (final r in _rows) {
      r.dispose();
    }
    _rows = d.lines.isEmpty
        ? [_Row()]
        : [
            for (final l in d.lines)
              _Row(
                serviceId: l.serviceId ?? _free,
                name: l.name,
                qty: '${l.qty}',
                price: '${l.unitPrice.round()}',
              ),
          ];
    _level = d.transportLevel;
    _mode = d.transportMode;
    _hydrated = true;
  }

  Future<void> _save(ServicePricing d, List<_Row> valid, bool wasPriced) async {
    setState(() => _saving = true);
    try {
      final inv = await saveServicePricing(
        widget.jobId,
        lines: [
          for (final r in valid)
            {
              if (r.serviceId.isNotEmpty) 'serviceId': r.serviceId,
              if (r.name.text.trim().isNotEmpty) 'name': r.name.text.trim(),
              'qty': r.qtyValue,
              'unitPrice': r.priceValue,
            },
        ],
        transportLevel: _level,
        transportMode: _mode,
      );
      if (!mounted) return;
      _hydrated = false;
      ref.invalidate(servicePricingProvider(widget.jobId));
      ref.invalidate(jobProvider(widget.jobId));
      ref.invalidate(jobsForCurrentUserProvider);
      ref.invalidate(invoicesStreamProvider);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Harga jasa ditetapkan.')));
      if (inv != null) await _showDone(inv, created: !wasPriced);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _showDone(({String id, String number}) inv, {required bool created}) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(created ? 'Invoice sudah dibuat' : 'Invoice diperbarui'),
        content: Text(
          '${created ? 'Invoice ${inv.number} sudah dibuat dari harga jasa ini.' : 'Harga di invoice ${inv.number} sudah diperbarui.'} '
          'Buka invoice untuk melanjutkan konfirmasi pembayaran dan mengirim struk ke WhatsApp pelanggan.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Tutup')),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.push('/transactions/${inv.id}');
            },
            child: const Text('Cek Invoice'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(servicePricingProvider(widget.jobId));
    // asData: katalog gagal dimuat tidak boleh menjatuhkan kartu (baris tetap bisa diketik sebagai "jasa lain").
    final catalog = (ref.watch(serviceListProvider).asData?.value ?? const []).where((s) => s.active).toList();

    return async.when(
      loading: () => const Card(
        child: Padding(padding: EdgeInsets.all(16), child: Text('Memuat harga jasa...')),
      ),
      error: (e, _) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text('Gagal memuat harga jasa: ${errorMessage(e)}', style: const TextStyle(color: AppColors.danger)),
        ),
      ),
      data: (d) {
        if (!_hydrated) _hydrate(d);
        final editable = d.editable;
        final valid = _rows.where((r) => r.valid).toList();
        final allValid = _rows.isNotEmpty && valid.length == _rows.length;

        final spareLines = [
          for (final r in d.spareparts.where((r) => !r.legacy))
            for (final i in r.items)
              if ((r.used ? (i.qtyUsed ?? i.qty) : i.qty) > 0)
                (name: i.name, qty: r.used ? (i.qtyUsed ?? i.qty) : i.qty, unitPrice: i.unitPrice),
        ];
        final legacyTotal = d.spareparts.where((r) => r.legacy).fold<num>(0, (s, r) => s + r.amount);
        final preview = buildPricingPreview(
          [
            for (final r in valid)
              (
                name: r.name.text.trim().isNotEmpty
                    ? r.name.text.trim()
                    : (catalog.where((c) => c.id == r.serviceId).firstOrNull?.name ?? 'Jasa'),
                qty: r.qtyValue!,
                unitPrice: r.priceValue!,
              ),
          ],
          spareLines,
          _level * transportStep,
          _mode,
        );
        final previewTotal = preview.fold<int>(0, (s, l) => s + l.lineTotal) + legacyTotal.round();

        return Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text('Harga Jasa & Tagihan',
                          style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.slate900)),
                    ),
                    StatusBadge(
                      label: d.findingsSentAt != null ? 'Temuan terkirim' : 'Temuan belum dikirim',
                      color: d.findingsSentAt != null ? AppColors.warning : AppColors.slate600,
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'Tentukan harga jasa setelah melihat temuan dan foto. Sparepart yang disetujui otomatis masuk ke tagihan yang sama.',
                  style: TextStyle(fontSize: 12, color: AppColors.slate600),
                ),
                const SizedBox(height: 12),
                for (var i = 0; i < _rows.length; i++) _rowEditor(i, catalog, editable),
                if (editable)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () => setState(() => _rows.add(_Row())),
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('Tambah baris'),
                    ),
                  ),
                const Divider(),
                const Text('Transport (opsional)', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                const SizedBox(height: 8),
                DropdownButtonFormField<int>(
                  key: const Key('pricing-transport'),
                  initialValue: _level,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true),
                  items: [
                    const DropdownMenuItem(value: 0, child: Text('Tanpa transport')),
                    for (final n in transportLevels)
                      DropdownMenuItem(value: n, child: Text('Transport $n (${formatRupiah(n * transportStep)})')),
                  ],
                  onChanged: editable ? (v) => setState(() => _level = v ?? 0) : null,
                ),
                if (_level > 0) ...[
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    key: const Key('pricing-transport-mode'),
                    initialValue: _mode,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true),
                    items: const [
                      DropdownMenuItem(value: 'individu', child: Text('Tampilkan sebagai biaya transport')),
                      DropdownMenuItem(value: 'dibagi', child: Text('Bagi rata ke jasa & sparepart')),
                    ],
                    onChanged: editable ? (v) => setState(() => _mode = v ?? 'individu') : null,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _mode == 'dibagi'
                        ? 'Transport dibagi sama rata ke tiap baris. Di struk tidak ada tulisan transport.'
                        : 'Transport tampil sebagai baris "Biaya transport" sendiri di tagihan dan struk.',
                    style: const TextStyle(fontSize: 12, color: AppColors.slate600),
                  ),
                ],
                const SizedBox(height: 12),
                _previewBox(preview, legacyTotal.round(), previewTotal, showFreeHint: allValid && previewTotal == 0),
                if (d.invoice != null) ...[const SizedBox(height: 12), _invoiceBox(d.invoice!)],
                const SizedBox(height: 12),
                if (!editable || d.invoice == null)
                  Text(
                    editable
                        ? 'Tagihan dibuat saat harga jasa pertama kali ditetapkan.'
                        : 'Job sudah selesai/dibatalkan, harga tidak bisa diubah.',
                    style: const TextStyle(fontSize: 12, color: AppColors.slate600),
                  ),
                if (editable) ...[
                  if (!allValid)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 8),
                      child: Text(
                        'Lengkapi tiap baris: pilih atau ketik nama jasa, jumlah, dan harga (isi 0 untuk gratis).',
                        style: TextStyle(fontSize: 12, color: AppColors.slate600),
                      ),
                    ),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      key: const Key('pricing-save'),
                      onPressed: allValid && !_saving ? () => _save(d, valid, d.priced) : null,
                      child: Text(_saving ? 'Menyimpan...' : d.priced ? 'Perbarui Harga Jasa' : 'Tetapkan Harga Jasa'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _rowEditor(int i, List catalog, bool editable) {
    final row = _rows[i];
    final known = catalog.any((s) => s.id == row.serviceId);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.hairline),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        children: [
          DropdownButtonFormField<String>(
            key: Key('pricing-service-$i'),
            initialValue: known ? row.serviceId : _free,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true, labelText: 'Jasa'),
            items: [
              for (final s in catalog)
                DropdownMenuItem(value: s.id as String, child: Text('${s.name} (${formatRupiah(s.basePrice)})', overflow: TextOverflow.ellipsis)),
              const DropdownMenuItem(value: _free, child: Text('Jasa lain (ketik nama)')),
            ],
            onChanged: editable
                ? (v) => setState(() {
                      row.serviceId = v ?? _free;
                      final svc = catalog.where((s) => s.id == v).firstOrNull;
                      if (svc == null) {
                        row.name.clear();
                      } else {
                        row.name.text = svc.name as String;
                        if (row.price.text.trim().isEmpty) row.price.text = '${svc.basePrice}';
                      }
                    })
                : null,
          ),
          const SizedBox(height: 8),
          TextField(
            controller: row.name,
            enabled: editable,
            decoration: InputDecoration(
              isDense: true,
              labelText: row.serviceId.isEmpty ? 'Nama jasa, mis. Bongkar kompresor' : 'Nama di tagihan (boleh diubah)',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              SizedBox(
                width: 80,
                child: TextField(
                  controller: row.qty,
                  enabled: editable,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                  decoration: const InputDecoration(isDense: true, labelText: 'Jumlah'),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: row.price,
                  enabled: editable,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(isDense: true, labelText: 'Harga satuan', prefixText: 'Rp '),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              IconButton(
                tooltip: 'Hapus baris',
                onPressed: editable && _rows.length > 1
                    ? () => setState(() => _rows.removeAt(i).dispose())
                    : null,
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _previewBox(List<PreviewLine> preview, int legacy, int total, {required bool showFreeHint}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppColors.mist, borderRadius: BorderRadius.circular(AppRadius.md)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Tampil di tagihan & struk',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.slate600)),
          const SizedBox(height: 4),
          if (preview.isEmpty) const Text('Isi baris jasa di atas.', style: TextStyle(fontSize: 12)),
          for (final l in preview)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: Text('${l.name}  ${l.qty} x ${formatRupiahNum(l.unitPrice)}', style: const TextStyle(fontSize: 13))),
                  Text(formatRupiah(l.lineTotal), style: const TextStyle(fontSize: 13)),
                ],
              ),
            ),
          if (legacy > 0)
            Row(children: [
              const Expanded(child: Text('Sparepart (pengajuan lama)', style: TextStyle(fontSize: 13))),
              Text(formatRupiah(legacy), style: const TextStyle(fontSize: 13)),
            ]),
          const Divider(height: 14),
          Row(children: [
            const Expanded(child: Text('Total tagihan servis ini', style: TextStyle(fontWeight: FontWeight.w600))),
            Text(formatRupiah(total), key: const Key('pricing-total'), style: const TextStyle(fontWeight: FontWeight.w600)),
          ]),
          if (showFreeHint)
            const Text('Total Rp 0 = servis gratis/garansi.', style: TextStyle(fontSize: 12, color: AppColors.slate600)),
        ],
      ),
    );
  }

  Widget _invoiceBox(PricingInvoice inv) {
    final outstanding = inv.grandTotal - inv.totalPaid;
    final lunas = inv.status == 'lunas';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.hairline),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Text(inv.number, style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(width: 8),
                  StatusBadge(label: inv.status, color: lunas ? AppColors.success : AppColors.warning),
                ]),
                const SizedBox(height: 2),
                Text(
                  'Dibayar ${formatRupiahNum(inv.totalPaid)} dari ${formatRupiahNum(inv.grandTotal)}'
                  '${outstanding > 0 ? ' • sisa ${formatRupiahNum(outstanding)}' : ''}',
                  style: const TextStyle(fontSize: 12, color: AppColors.slate600),
                ),
              ],
            ),
          ),
          OutlinedButton(
            key: const Key('pricing-open-invoice'),
            onPressed: () => context.push('/transactions/${inv.id}'),
            child: const Text('Cek Invoice'),
          ),
        ],
      ),
    );
  }
}
