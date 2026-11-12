import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../data/models/member.dart';
import 'member_providers.dart';
import 'unit_label_pdf.dart';

// Input Data Lampau (admin), padanan administrasi/data-lampau di web: mencatat pelanggan lama beserta unit ACnya
// (tipe diketahui, atau "QR dulu" yang dilengkapi teknisi saat scan) dan, bila ada, satu transaksi lampau.
// POST /legacy-import. Pemilihan produk master per unit belum ada di mobile (merk/model diketik).

class LegacyUnitInput {
  LegacyUnitInput({
    this.qrDulu = false,
    this.room = '',
    this.brand = '',
    this.model = '',
    this.pk = '',
    this.serial = '',
    this.installationDate,
    this.lastServiceDate,
    this.intervalDays = '',
  });
  bool qrDulu;
  String room;
  String brand;
  String model;
  String pk;
  String serial;
  DateTime? installationDate;
  DateTime? lastServiceDate;
  String intervalDays;
}

class LegacyItemInput {
  LegacyItemInput({this.name = '', this.qty = '1', this.unitPrice = ''});
  String name;
  String qty;
  String unitPrice;
  num get qtyValue => num.tryParse(qty.replaceAll(',', '.')) ?? 0;
  num? get priceValue => num.tryParse(unitPrice);
  int get lineTotal => (qtyValue * (priceValue ?? 0)).round();
}

String _ymd(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)}';
}

/// Siklus servis 7–730 hari (kosong boleh). Padanan intervalError di Monitoring Jadwal.
String? legacyIntervalError(String text) {
  if (text.trim().isEmpty) return null;
  final n = int.tryParse(text.trim());
  if (n == null) return 'harus bilangan bulat (hari)';
  if (n < 7) return 'minimal 7 hari';
  if (n > 730) return 'maksimal 730 hari';
  return null;
}

/// Kembalikan pesan galat pertama, atau null bila siap dikirim. Aturan sama dengan validate() di web.
String? validateLegacy({
  required bool existingMember,
  required String? memberId,
  required String name,
  required String address,
  required String? memberAddress,
  required List<LegacyUnitInput> units,
  required bool withInvoice,
  DateTime? invDate,
  List<LegacyItemInput> items = const [],
  num discount = 0,
  num paid = 0,
}) {
  if (existingMember && memberId == null) return 'Pilih member dulu, atau pindah ke "Member Baru".';
  if (!existingMember && name.trim().isEmpty) return 'Nama member wajib diisi.';
  final effectiveAddress = address.trim().isNotEmpty ? address.trim() : (existingMember ? (memberAddress ?? '').trim() : '');
  for (final (i, u) in units.indexed) {
    final no = 'Unit #${i + 1}';
    if (u.qrDulu) {
      if (effectiveAddress.isEmpty) return '$no: alamat member wajib diisi untuk mode "QR dulu" (tercetak di label).';
      continue;
    }
    if (u.brand.trim().isEmpty && u.model.trim().isEmpty) {
      return '$no: isi merk atau model. Kalau belum tahu, pakai mode "QR dulu".';
    }
    if (u.pk.trim().isNotEmpty && num.tryParse(u.pk.replaceAll(',', '.')) == null) return '$no: PK harus angka.';
    final err = legacyIntervalError(u.intervalDays);
    if (err != null) return '$no: siklus servis $err.';
  }
  if (units.isEmpty && !withInvoice) return 'Tambah minimal satu unit AC atau sertakan transaksi lampau.';
  if (withInvoice) {
    if (invDate == null) return 'Tanggal transaksi lampau wajib diisi.';
    final valid = items.where((it) => it.name.trim().isNotEmpty).toList();
    if (valid.isEmpty) return 'Transaksi lampau butuh minimal satu item.';
    if (valid.any((it) => it.qtyValue <= 0 || it.priceValue == null)) return 'Qty dan harga item transaksi harus diisi dengan benar.';
    final grand = (valid.fold<int>(0, (s, it) => s + it.lineTotal) - discount).clamp(0, double.infinity);
    if (paid > grand) return 'Jumlah dibayar tidak boleh melebihi total transaksi.';
  }
  return null;
}

/// Muatan `POST /legacy-import` (bentuk sama dengan web).
Map<String, dynamic> buildLegacyPayload({
  required bool existingMember,
  String? memberId,
  String name = '',
  String phone = '',
  String address = '',
  required List<LegacyUnitInput> units,
  bool withInvoice = false,
  DateTime? invDate,
  List<LegacyItemInput> items = const [],
  num discount = 0,
  num paid = 0,
  String notes = '',
}) {
  String? opt(String v) => v.trim().isEmpty ? null : v.trim();
  return {
    'member': existingMember
        ? {'memberId': memberId, if (opt(address) != null) 'address': opt(address)}
        : {'name': name.trim(), if (opt(phone) != null) 'phone': opt(phone), if (opt(address) != null) 'address': opt(address)},
    'units': [
      for (final u in units)
        u.qrDulu
            ? {'mode': 'qr_dulu', if (opt(u.room) != null) 'roomLocation': opt(u.room)}
            : {
                'mode': 'diketahui',
                if (opt(u.room) != null) 'roomLocation': opt(u.room),
                if (opt(u.brand) != null) 'brand': opt(u.brand),
                if (opt(u.model) != null) 'model': opt(u.model),
                if (opt(u.pk) != null) 'pk': num.parse(u.pk.trim().replaceAll(',', '.')),
                if (opt(u.serial) != null) 'serialNumber': opt(u.serial),
                if (u.installationDate != null) 'installationDate': _ymd(u.installationDate!),
                if (u.lastServiceDate != null) 'lastServiceDate': _ymd(u.lastServiceDate!),
                if (opt(u.intervalDays) != null) 'serviceIntervalDays': int.parse(u.intervalDays.trim()),
              },
    ],
    if (withInvoice)
      'invoice': {
        'date': _ymd(invDate!),
        'items': [
          for (final it in items)
            if (it.name.trim().isNotEmpty) {'name': it.name.trim(), 'qty': it.qtyValue, 'unitPrice': it.priceValue},
        ],
        if (discount > 0) 'discount': discount,
        if (paid > 0) 'totalPaid': paid,
        if (opt(notes) != null) 'notes': opt(notes),
      },
  };
}

class LegacyImportResult {
  LegacyImportResult(Map<String, dynamic> j)
      : memberName = ((j['member'] as Map?)?['name'] as String?) ?? '',
        memberIsNew = j['memberIsNew'] == true,
        invoiceNumber = (j['invoice'] as Map?)?['number'] as String?,
        unitIds = [for (final u in (j['units'] as List? ?? const [])) '${(u as Map)['id']}'];
  final String memberName;
  final bool memberIsNew;
  final String? invoiceNumber;
  final List<String> unitIds;
}

final legacyImportCallerProvider = Provider<Future<LegacyImportResult> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final r = await const ApiClient().post('/legacy-import', body: payload) as Map;
    ref.invalidate(membersStreamProvider);
    return LegacyImportResult(Map<String, dynamic>.from(r));
  };
});

class LegacyImportScreen extends ConsumerStatefulWidget {
  const LegacyImportScreen({super.key});

  @override
  ConsumerState<LegacyImportScreen> createState() => _LegacyImportScreenState();
}

class _LegacyImportScreenState extends ConsumerState<LegacyImportScreen> {
  bool _existing = true;
  String? _memberId;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _address = TextEditingController();
  final _units = <LegacyUnitInput>[];
  bool _withInvoice = false;
  DateTime? _invDate;
  final _items = <LegacyItemInput>[LegacyItemInput()];
  final _discount = TextEditingController();
  final _paid = TextEditingController();
  final _notes = TextEditingController();
  bool _busy = false;
  LegacyImportResult? _result;

  @override
  void dispose() {
    for (final c in [_name, _phone, _address, _discount, _paid, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  num _n(TextEditingController c) => num.tryParse(c.text.trim()) ?? 0;

  Future<DateTime?> _pickDate(DateTime? initial) => showDatePicker(
        context: context,
        initialDate: initial ?? DateTime.now(),
        firstDate: DateTime(2000),
        lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
      );

  String? _error(List<Member> members) => validateLegacy(
        existingMember: _existing,
        memberId: _memberId,
        name: _name.text,
        address: _address.text,
        memberAddress: members.where((m) => m.id == _memberId).firstOrNull?.address,
        units: _units,
        withInvoice: _withInvoice,
        invDate: _invDate,
        items: _items,
        discount: _n(_discount),
        paid: _n(_paid),
      );

  Future<void> _submit(List<Member> members) async {
    final err = _error(members);
    final messenger = ScaffoldMessenger.of(context);
    if (err != null) {
      messenger.showSnackBar(SnackBar(content: Text(err), backgroundColor: AppColors.danger));
      return;
    }
    setState(() => _busy = true);
    try {
      final r = await ref.read(legacyImportCallerProvider)(buildLegacyPayload(
        existingMember: _existing,
        memberId: _memberId,
        name: _name.text,
        phone: _phone.text,
        address: _address.text,
        units: _units,
        withInvoice: _withInvoice,
        invDate: _invDate,
        items: _items,
        discount: _n(_discount),
        paid: _n(_paid),
        notes: _notes.text,
      ));
      if (mounted) setState(() => _result = r);
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _reset() => setState(() {
        _result = null;
        _units.clear();
        _withInvoice = false;
        _invDate = null;
        _items
          ..clear()
          ..add(LegacyItemInput());
        for (final c in [_discount, _paid, _notes]) {
          c.clear();
        }
      });

  Future<void> _printLabels(List<String> ids) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      for (final id in ids) {
        final unit = await ref.read(acUnitProvider(id).future);
        if (unit == null) continue;
        await Printing.layoutPdf(onLayout: (_) => buildUnitLabelPdf(unit), name: 'Label-${unit.barcodeValue}');
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Gagal menyiapkan label: ${errorMessage(e)}'), backgroundColor: AppColors.danger));
    }
  }

  @override
  Widget build(BuildContext context) {
    final membersAsync = ref.watch(membersStreamProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Input Data Lampau')),
      body: membersAsync.when(
        loading: () => const AppSkeletonDetail(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat member'),
        data: (members) => _result != null ? _resultView(_result!) : _form(members.where((m) => m.active).toList()),
      ),
    );
  }

  Widget _resultView(LegacyImportResult r) => ListView(padding: const EdgeInsets.all(16), children: [
        Text('Tersimpan: ${r.memberName}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(
          '${r.memberIsNew ? 'Member baru dibuat.' : 'Ditambahkan ke member yang sudah ada.'}'
          '${r.invoiceNumber == null ? '' : ' Transaksi lampau ${r.invoiceNumber} tercatat.'}'
          ' ${r.unitIds.length} unit AC ditambahkan.',
        ),
        const SizedBox(height: 16),
        if (r.unitIds.isNotEmpty)
          FilledButton.icon(
            key: const Key('legacy-print-labels'),
            onPressed: () => _printLabels(r.unitIds),
            icon: const Icon(Icons.qr_code_2),
            label: Text('Cetak Label QR (${r.unitIds.length})'),
          ),
        const SizedBox(height: 8),
        OutlinedButton(key: const Key('legacy-again'), onPressed: _reset, child: const Text('Input pelanggan lain')),
      ]);

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8, top: 4),
        child: Text(t, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.slate700)),
      );

  Widget _form(List<Member> members) {
    final subtotal = _items.fold<int>(0, (s, it) => s + it.lineTotal);
    final grand = (subtotal - _n(_discount)).clamp(0, double.infinity);
    return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 32), children: [
      _label('Member'),
      SegmentedButton<bool>(
        key: const Key('legacy-member-mode'),
        segments: const [ButtonSegment(value: true, label: Text('Member lama')), ButtonSegment(value: false, label: Text('Member baru'))],
        selected: {_existing},
        onSelectionChanged: (v) => setState(() => _existing = v.first),
      ),
      const SizedBox(height: 10),
      if (_existing)
        DropdownButtonFormField<String>(
          key: const Key('legacy-member'),
          initialValue: members.any((m) => m.id == _memberId) ? _memberId : null,
          isExpanded: true,
          decoration: const InputDecoration(hintText: 'Pilih member'),
          items: [for (final m in members) DropdownMenuItem(value: m.id, child: Text('${m.name} · ${m.phone}', overflow: TextOverflow.ellipsis))],
          onChanged: (v) => setState(() => _memberId = v),
        )
      else ...[
        TextField(key: const Key('legacy-name'), controller: _name, decoration: const InputDecoration(labelText: 'Nama member'), onChanged: (_) => setState(() {})),
        const SizedBox(height: 8),
        TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'No. HP (boleh kosong)')),
      ],
      const SizedBox(height: 8),
      TextField(
        key: const Key('legacy-address'),
        controller: _address,
        maxLines: 2,
        onChanged: (_) => setState(() {}),
        decoration: const InputDecoration(labelText: 'Alamat', helperText: 'Tercetak di label QR. Wajib kalau ada unit mode "QR dulu".'),
      ),
      const SizedBox(height: 16),
      _label('Unit AC (${_units.length})'),
      for (final (i, u) in _units.indexed) _unitCard(i, u),
      OutlinedButton.icon(
        key: const Key('legacy-add-unit'),
        onPressed: () => setState(() => _units.add(LegacyUnitInput())),
        icon: const Icon(Icons.add),
        label: const Text('Tambah unit AC'),
      ),
      const SizedBox(height: 16),
      SwitchListTile(
        key: const Key('legacy-with-invoice'),
        contentPadding: EdgeInsets.zero,
        title: const Text('Sertakan transaksi lampau', style: TextStyle(fontWeight: FontWeight.w600)),
        subtitle: const Text('Opsional - bila nominalnya masih tercatat.'),
        value: _withInvoice,
        onChanged: (v) => setState(() => _withInvoice = v),
      ),
      if (_withInvoice) ...[
        OutlinedButton.icon(
          key: const Key('legacy-inv-date'),
          onPressed: () async {
            final d = await _pickDate(_invDate);
            if (d != null) setState(() => _invDate = d);
          },
          icon: const Icon(Icons.event_outlined),
          label: Text(_invDate == null ? 'Tanggal transaksi' : _ymd(_invDate!)),
        ),
        const SizedBox(height: 8),
        for (final (i, it) in _items.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              Expanded(
                flex: 3,
                child: TextField(
                  key: Key('legacy-item-name-$i'),
                  decoration: const InputDecoration(labelText: 'Item', isDense: true),
                  onChanged: (v) => setState(() => it.name = v),
                ),
              ),
              const SizedBox(width: 6),
              SizedBox(
                width: 54,
                child: TextFormField(
                  key: Key('legacy-item-qty-$i'),
                  initialValue: it.qty,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Qty', isDense: true),
                  onChanged: (v) => setState(() => it.qty = v),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                flex: 2,
                child: TextField(
                  key: Key('legacy-item-price-$i'),
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(labelText: 'Harga', isDense: true),
                  onChanged: (v) => setState(() => it.unitPrice = v),
                ),
              ),
              IconButton(
                tooltip: 'Hapus item',
                onPressed: _items.length == 1 ? null : () => setState(() => _items.removeAt(i)),
                icon: const Icon(Icons.delete_outline),
              ),
            ]),
          ),
        TextButton.icon(
          key: const Key('legacy-add-item'),
          onPressed: () => setState(() => _items.add(LegacyItemInput())),
          icon: const Icon(Icons.add),
          label: const Text('Tambah item'),
        ),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _discount,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(labelText: 'Diskon (Rp)', isDense: true),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              key: const Key('legacy-paid'),
              controller: _paid,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(labelText: 'Dibayar (Rp)', isDense: true),
            ),
          ),
        ]),
        const SizedBox(height: 8),
        TextField(controller: _notes, decoration: const InputDecoration(labelText: 'Catatan (opsional)', isDense: true)),
        const SizedBox(height: 8),
        Text('Total transaksi: ${formatRupiahNum(grand)}', key: const Key('legacy-total'), style: const TextStyle(fontWeight: FontWeight.w700)),
      ],
      const SizedBox(height: 24),
      SizedBox(
        height: 52,
        child: FilledButton.icon(
          key: const Key('legacy-submit'),
          onPressed: _busy ? null : () => _submit(members),
          icon: const Icon(Icons.save_outlined),
          label: Text(_busy ? 'Menyimpan...' : 'Simpan'),
        ),
      ),
    ]);
  }

  Widget _unitCard(int i, LegacyUnitInput u) {
    final intervalErr = u.qrDulu ? null : legacyIntervalError(u.intervalDays);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(children: [
          Row(children: [
            Expanded(child: Text('Unit #${i + 1}', style: const TextStyle(fontWeight: FontWeight.w600))),
            IconButton(tooltip: 'Hapus unit', onPressed: () => setState(() => _units.removeAt(i)), icon: const Icon(Icons.delete_outline)),
          ]),
          SwitchListTile(
            key: Key('legacy-unit-qr-$i'),
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: const Text('QR dulu (tipe AC diisi teknisi)'),
            subtitle: const Text('Pengingat WA mati sampai datanya dilengkapi.'),
            value: u.qrDulu,
            onChanged: (v) => setState(() => u.qrDulu = v),
          ),
          TextField(
            decoration: const InputDecoration(labelText: 'Lokasi ruangan (opsional)', isDense: true),
            onChanged: (v) => u.room = v,
          ),
          if (!u.qrDulu) ...[
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: TextField(key: Key('legacy-unit-brand-$i'), decoration: const InputDecoration(labelText: 'Merek', isDense: true), onChanged: (v) => u.brand = v)),
              const SizedBox(width: 8),
              Expanded(child: TextField(decoration: const InputDecoration(labelText: 'Model', isDense: true), onChanged: (v) => u.model = v)),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: TextField(
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'PK', isDense: true),
                  onChanged: (v) => u.pk = v,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(child: TextField(decoration: const InputDecoration(labelText: 'No. seri', isDense: true), onChanged: (v) => u.serial = v)),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () async {
                    final d = await _pickDate(u.installationDate);
                    if (d != null) setState(() => u.installationDate = d);
                  },
                  child: Text(u.installationDate == null ? 'Tgl pasang' : _ymd(u.installationDate!), overflow: TextOverflow.ellipsis),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  onPressed: () async {
                    final d = await _pickDate(u.lastServiceDate);
                    if (d != null) setState(() => u.lastServiceDate = d);
                  },
                  child: Text(u.lastServiceDate == null ? 'Servis terakhir' : _ymd(u.lastServiceDate!), overflow: TextOverflow.ellipsis),
                ),
              ),
            ]),
            const SizedBox(height: 8),
            TextField(
              key: Key('legacy-unit-interval-$i'),
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(
                labelText: 'Siklus servis (hari, opsional)',
                helperText: 'Diisi = pengingat WA menyala',
                errorText: intervalErr == null ? null : 'Siklus servis $intervalErr',
                isDense: true,
              ),
              onChanged: (v) => setState(() => u.intervalDays = v),
            ),
          ],
        ]),
      ),
    );
  }
}
