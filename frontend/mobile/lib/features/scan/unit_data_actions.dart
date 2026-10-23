import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/notice_panel.dart';
import '../../data/models/ac_unit.dart';

const _api = ApiClient();

String _isoDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// `POST /ac-units/:id/complete-data` — melengkapi unit `menunggu_data` (merk + PK wajib).
Future<void> completeUnitData(
  String unitId, {
  required String brand,
  required double pk,
  String? model,
  String? serialNumber,
  String? roomLocation,
  DateTime? installationDate,
  DateTime? lastServiceDate,
}) =>
    _api.post('/ac-units/$unitId/complete-data', body: {
      'brand': brand,
      'pk': pk,
      if ((model ?? '').isNotEmpty) 'model': model,
      if ((serialNumber ?? '').isNotEmpty) 'serialNumber': serialNumber,
      if ((roomLocation ?? '').isNotEmpty) 'roomLocation': roomLocation,
      if (installationDate != null) 'installationDate': _isoDate(installationDate),
      if (lastServiceDate != null) 'lastServiceDate': _isoDate(lastServiceDate),
    });

/// Isi koreksi: hanya kolom yang BERUBAH dari data unit (+ catatan bila ada).
/// Null bila tidak ada yang berubah. Murni supaya bisa diuji.
Map<String, dynamic>? buildCorrectionPayload(
  AcUnit unit, {
  required String brand,
  required String model,
  required String pk,
  required String room,
  required String serial,
  String note = '',
}) {
  final changes = <String, dynamic>{};
  if (brand.trim() != unit.brand) changes['brand'] = brand.trim();
  if (model.trim() != unit.model) changes['model'] = model.trim();
  if (room.trim() != unit.roomLocation) changes['roomLocation'] = room.trim();
  if (serial.trim() != (unit.serialNumber ?? '')) changes['serialNumber'] = serial.trim();
  final pkNum = double.tryParse(pk.trim().replaceAll(',', '.'));
  if (pkNum != null && pkNum != unit.pk) changes['pk'] = pkNum;
  if (changes.isEmpty) return null;
  if (note.trim().isNotEmpty) changes['note'] = note.trim();
  return changes;
}

/// Sudah ada koreksi yang menunggu persetujuan admin untuk unit ini?
final unitPendingCorrectionProvider =
    FutureProvider.autoDispose.family<bool, String>((ref, unitId) async {
  final r = await _api.get('/ac-units/$unitId/corrections/pending');
  return r != null;
});

/// Unit 'menunggu_data' (QR dibuat dulu, tipe belum diketahui): teknisi WAJIB mengisi
/// merk + PK dari kondisi AC di lokasi sebelum lanjut kerja.
class CompleteUnitDataPanel extends StatefulWidget {
  const CompleteUnitDataPanel({super.key, required this.unit, required this.onDone});

  final AcUnit unit;
  final VoidCallback onDone;

  @override
  State<CompleteUnitDataPanel> createState() => _CompleteUnitDataPanelState();
}

class _CompleteUnitDataPanelState extends State<CompleteUnitDataPanel> {
  final _brand = TextEditingController();
  final _model = TextEditingController();
  final _pk = TextEditingController();
  final _serial = TextEditingController();
  late final _room = TextEditingController(text: widget.unit.roomLocation);
  DateTime? _installed;
  DateTime? _lastService;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_brand, _model, _pk, _serial, _room]) {
      c.dispose();
    }
    super.dispose();
  }

  double? get _pkValue => double.tryParse(_pk.text.trim().replaceAll(',', '.'));
  bool get _valid => _brand.text.trim().isNotEmpty && (_pkValue ?? 0) > 0;

  Future<DateTime?> _pickDate(DateTime? initial) => showDatePicker(
        context: context,
        initialDate: initial ?? DateTime.now(),
        firstDate: DateTime(2000),
        lastDate: DateTime.now(),
      );

  Future<void> _save() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await completeUnitData(
        widget.unit.id,
        brand: _brand.text.trim(),
        pk: _pkValue!,
        model: _model.text.trim(),
        serialNumber: _serial.text.trim(),
        roomLocation: _room.text.trim(),
        installationDate: _installed,
        lastServiceDate: _lastService,
      );
      messenger.showSnackBar(const SnackBar(content: Text('Data unit tersimpan.')));
      widget.onDone();
    } catch (e) {
      messenger.showSnackBar(SnackBar(
        content: Text(errorMessage(e)),
        backgroundColor: AppColors.danger,
      ));
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _field(String label, TextEditingController c, {Key? key, TextInputType? type}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TextField(
          key: key,
          controller: c,
          keyboardType: type,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(labelText: label),
        ),
      );

  Widget _dateButton(String label, DateTime? value, ValueChanged<DateTime> onPicked) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () async {
              final d = await _pickDate(value);
              if (d != null) setState(() => onPicked(d));
            },
            icon: const Icon(Icons.event, size: 18),
            label: Text(value == null ? label : '$label: ${_isoDate(value)}'),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const Key('complete-unit-data'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const NoticePanel(
          tone: NoticeTone.warning,
          icon: Icons.edit_note,
          text:
              'Unit ini baru diberi QR dan tipe ACnya belum diketahui. Lihat langsung AC di lokasi, '
              'lalu isi data di bawah (merk dan PK wajib) sebelum melanjutkan pekerjaan.',
        ),
        const SizedBox(height: 12),
        _field('Merk *', _brand, key: const Key('cud-brand')),
        _field('Model / tipe', _model),
        _field('PK *', _pk,
            key: const Key('cud-pk'),
            type: const TextInputType.numberWithOptions(decimal: true)),
        _field('No. seri', _serial),
        _field('Ruangan', _room),
        _dateButton('Tanggal pasang (kalau tahu)', _installed, (d) => _installed = d),
        _dateButton('Servis terakhir (kalau tahu)', _lastService, (d) => _lastService = d),
        const SizedBox(height: 4),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: FilledButton(
            key: const Key('cud-save'),
            onPressed: (_valid && !_busy) ? _save : null,
            child: Text(_busy ? 'Menyimpan...' : 'Simpan Data Unit'),
          ),
        ),
      ],
    );
  }
}

/// Unit aktif: teknisi tidak mengubah data langsung — ajukan koreksi ke admin.
class UnitCorrectionPanel extends ConsumerWidget {
  const UnitCorrectionPanel({super.key, required this.unit});

  final AcUnit unit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pending = ref.watch(unitPendingCorrectionProvider(unit.id));
    if (pending.value == true) {
      return const NoticePanel(
        tone: NoticeTone.warning,
        icon: Icons.hourglass_empty,
        text: 'Koreksi data unit ini sudah dikirim dan menunggu persetujuan admin.',
      );
    }
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: OutlinedButton.icon(
        key: const Key('open-correction'),
        icon: const Icon(Icons.edit_outlined, size: 18),
        label: const Text('Data tidak sesuai? Ajukan koreksi'),
        onPressed: () async {
          final sent = await showDialog<bool>(
            context: context,
            builder: (_) => _CorrectionDialog(unit: unit),
          );
          if (sent == true) ref.invalidate(unitPendingCorrectionProvider(unit.id));
        },
      ),
    );
  }
}

class _CorrectionDialog extends StatefulWidget {
  const _CorrectionDialog({required this.unit});
  final AcUnit unit;

  @override
  State<_CorrectionDialog> createState() => _CorrectionDialogState();
}

class _CorrectionDialogState extends State<_CorrectionDialog> {
  late final _brand = TextEditingController(text: widget.unit.brand);
  late final _model = TextEditingController(text: widget.unit.model);
  late final _pk = TextEditingController(
      text: widget.unit.pk == widget.unit.pk.roundToDouble()
          ? '${widget.unit.pk.toInt()}'
          : '${widget.unit.pk}');
  late final _serial = TextEditingController(text: widget.unit.serialNumber ?? '');
  late final _room = TextEditingController(text: widget.unit.roomLocation);
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_brand, _model, _pk, _serial, _room, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final messenger = ScaffoldMessenger.of(context);
    final payload = buildCorrectionPayload(
      widget.unit,
      brand: _brand.text,
      model: _model.text,
      pk: _pk.text,
      room: _room.text,
      serial: _serial.text,
      note: _note.text,
    );
    if (payload == null) {
      messenger.showSnackBar(const SnackBar(content: Text('Belum ada data yang diubah.')));
      return;
    }
    setState(() => _busy = true);
    try {
      await _api.post('/ac-units/${widget.unit.id}/corrections', body: payload);
      messenger.showSnackBar(const SnackBar(content: Text('Koreksi dikirim ke admin.')));
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      messenger.showSnackBar(SnackBar(
        content: Text(errorMessage(e)),
        backgroundColor: AppColors.danger,
      ));
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _f(String label, TextEditingController c, {TextInputType? type, int lines = 1}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TextField(
          controller: c,
          keyboardType: type,
          maxLines: lines,
          decoration: InputDecoration(labelText: label),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Ajukan Koreksi Data Unit'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Ubah kolom yang salah. Data baru berlaku setelah admin menyetujui.',
                style: TextStyle(color: AppColors.slate500, fontSize: 13)),
            const SizedBox(height: 12),
            _f('Merk', _brand),
            _f('Model', _model),
            _f('PK', _pk, type: const TextInputType.numberWithOptions(decimal: true)),
            _f('No. seri', _serial),
            _f('Ruangan', _room),
            _f('Catatan untuk admin', _note, lines: 2),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Batal'),
        ),
        FilledButton(
          key: const Key('send-correction'),
          onPressed: _busy ? null : _submit,
          child: Text(_busy ? 'Mengirim...' : 'Kirim Koreksi'),
        ),
      ],
    );
  }
}
