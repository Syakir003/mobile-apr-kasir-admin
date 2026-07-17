import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:printing/printing.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/ac_unit.dart';
import 'member_providers.dart';
import 'unit_label_pdf.dart';

const _kPkOptions = <double>[0.5, 0.75, 1, 1.5, 2];

class UnitFormScreen extends ConsumerStatefulWidget {
  const UnitFormScreen({super.key, required this.memberId, this.initial});

  final String memberId;
  final AcUnit? initial;

  @override
  ConsumerState<UnitFormScreen> createState() => _UnitFormScreenState();
}

class _UnitFormScreenState extends ConsumerState<UnitFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _brand;
  late final TextEditingController _model;
  late final TextEditingController _roomLocation;
  late final TextEditingController _serialNumber;
  late double _pk;
  late AcUnitStatus _status;
  late String _barcodeValue;
  bool _busy = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final u = widget.initial;
    _brand = TextEditingController(text: u?.brand ?? '');
    _model = TextEditingController(text: u?.model ?? '');
    _roomLocation = TextEditingController(text: u?.roomLocation ?? '');
    _serialNumber = TextEditingController(text: u?.serialNumber ?? '');
    _pk = u?.pk ?? _kPkOptions.first;
    _status = u?.status ?? AcUnitStatus.menungguPemasangan;
    _barcodeValue = u?.barcodeValue ?? '';
  }

  @override
  void dispose() {
    _brand.dispose();
    _model.dispose();
    _roomLocation.dispose();
    _serialNumber.dispose();
    super.dispose();
  }

  String? _requiredValidator(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null;

  AcUnit _buildUnit() {
    final serialText = _serialNumber.text.trim();
    return AcUnit(
      id: widget.initial?.id ?? '',
      memberId: widget.memberId,
      brand: _brand.text.trim(),
      model: _model.text.trim(),
      pk: _pk,
      roomLocation: _roomLocation.text.trim(),
      barcodeValue: _barcodeValue,
      serialNumber: serialText.isEmpty ? null : serialText,
      installationDate: widget.initial?.installationDate,
      lastServiceDate: widget.initial?.lastServiceDate,
      nextServiceDate: widget.initial?.nextServiceDate,
      status: _status,
    );
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final unit = _buildUnit();
    final repo = ref.read(acUnitRepositoryProvider);
    final generate = ref.read(acUnitBarcodeGeneratorProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (_isEdit) {
        await repo.update(widget.initial!.id, unit);
        if (!mounted) return;
        messenger.showSnackBar(
          const SnackBar(content: Text('Unit tersimpan.')),
        );
      } else {
        final id = await repo.create(unit);
        String barcode = '';
        Object? genError;
        try {
          barcode = await generate(id);
        } catch (e) {
          genError = e;
        }
        if (!mounted) return;
        if (genError == null) {
          messenger.showSnackBar(
            SnackBar(content: Text('Unit tersimpan. Barcode: $barcode')),
          );
        } else {
          // Unit tetap tersimpan; barcode bisa digenerate ulang dari form edit.
          messenger.showSnackBar(
            const SnackBar(
              content: Text('Unit tersimpan, barcode gagal digenerate.'),
              backgroundColor: AppColors.danger,
            ),
          );
        }
      }
      context.go('/members/${widget.memberId}');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(
        SnackBar(
          content: Text('Gagal menyimpan: $e'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  Future<void> _generateBarcode() async {
    setState(() => _busy = true);
    final generate = ref.read(acUnitBarcodeGeneratorProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final barcode = await generate(widget.initial!.id);
      if (!mounted) return;
      setState(() {
        _barcodeValue = barcode;
        _busy = false;
      });
      messenger.showSnackBar(SnackBar(content: Text('Barcode: $barcode')));
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(
        SnackBar(
          content: Text('Gagal generate barcode: $e'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  Future<void> _printLabel() async {
    final unit = _buildUnit();
    await Printing.layoutPdf(onLayout: (_) => buildUnitLabelPdf(unit));
  }

  @override
  Widget build(BuildContext context) {
    // Pk lama di luar opsi standar tetap ditampilkan agar dropdown valid.
    final pkItems = {..._kPkOptions, _pk}.toList()..sort();
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit Unit AC' : 'Tambah Unit AC')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
            TextFormField(
              key: const Key('brand'),
              controller: _brand,
              decoration: const InputDecoration(labelText: 'Merek'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('model'),
              controller: _model,
              decoration: const InputDecoration(labelText: 'Model'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<double>(
              key: const Key('pk'),
              initialValue: _pk,
              decoration: const InputDecoration(labelText: 'PK'),
              items: [
                for (final pk in pkItems)
                  DropdownMenuItem(value: pk, child: Text('$pk PK')),
              ],
              onChanged: (v) => setState(() => _pk = v ?? _pk),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('roomLocation'),
              controller: _roomLocation,
              decoration: const InputDecoration(labelText: 'Lokasi Ruangan'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('serialNumber'),
              controller: _serialNumber,
              decoration:
                  const InputDecoration(labelText: 'Serial Number (opsional)'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<AcUnitStatus>(
              key: const Key('status'),
              initialValue: _status,
              decoration: const InputDecoration(labelText: 'Status'),
              items: [
                for (final s in AcUnitStatus.values)
                  DropdownMenuItem(value: s, child: Text(s.label)),
              ],
              onChanged: (v) => setState(() => _status = v ?? _status),
            ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (_isEdit) ...[
              const SizedBox(height: 12),
              if (_barcodeValue.isNotEmpty)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.qr_code_2),
                  title: Text(_barcodeValue),
                  subtitle: const Text('Barcode unit'),
                ),
              if (_barcodeValue.isEmpty)
                OutlinedButton.icon(
                  key: const Key('generate-barcode'),
                  onPressed: _busy ? null : _generateBarcode,
                  icon: const Icon(Icons.qr_code_2),
                  label: const Text('Generate Barcode'),
                )
              else
                OutlinedButton.icon(
                  key: const Key('print-label'),
                  onPressed: _busy ? null : _printLabel,
                  icon: const Icon(Icons.print_outlined),
                  label: const Text('Cetak Label'),
                ),
            ],
            const SizedBox(height: 24),
            SizedBox(
              height: 50,
              width: double.infinity,
              child: FilledButton(
                key: const Key('submit'),
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Simpan'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
