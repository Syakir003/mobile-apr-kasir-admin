import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:printing/printing.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/ac_unit.dart';
import 'member_providers.dart';
import 'unit_label_pdf.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/form_scaffold.dart';

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
          content: Text('Gagal menyimpan: ${errorMessage(e)}'),
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
          content: Text('Gagal generate barcode: ${errorMessage(e)}'),
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
    return AppFormScaffold(
      title: _isEdit ? 'Edit Unit AC' : 'Tambah Unit AC',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Simpan',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        AppFormCard(
          title: 'Identitas Unit',
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: AppTextField(
                    key: const Key('brand'),
                    label: 'Merek',
                    required: true,
                    controller: _brand,
                    enabled: !_busy,
                    validator: _requiredValidator,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppTextField(
                    key: const Key('model'),
                    label: 'Model',
                    required: true,
                    controller: _model,
                    enabled: !_busy,
                    validator: _requiredValidator,
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: AppSelectField<double>(
                    key: const Key('pk'),
                    label: 'PK',
                    required: true,
                    value: _pk,
                    enabled: !_busy,
                    items: [
                      for (final pk in pkItems)
                        DropdownMenuItem(value: pk, child: Text('$pk PK')),
                    ],
                    onChanged: (v) => setState(() => _pk = v ?? _pk),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppSelectField<AcUnitStatus>(
                    key: const Key('status'),
                    label: 'Status',
                    required: true,
                    value: _status,
                    enabled: !_busy,
                    items: [
                      for (final s in AcUnitStatus.values)
                        DropdownMenuItem(value: s, child: Text(s.label)),
                    ],
                    onChanged: (v) => setState(() => _status = v ?? _status),
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('roomLocation'),
              label: 'Lokasi Ruangan',
              hint: 'Contoh: Ruang Meeting Lt. 2',
              controller: _roomLocation,
              enabled: !_busy,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('serialNumber'),
              label: 'Serial Number',
              hint: 'Tertera di bodi unit',
              controller: _serialNumber,
              enabled: !_busy,
            ),
          ],
        ),
        if (_isEdit) ...[
          const SizedBox(height: AppSpacing.grid),
          AppFormCard(
            title: 'Barcode Unit',
            subtitle: 'Dipakai teknisi untuk memindai unit di lokasi.',
            children: [
              if (_barcodeValue.isNotEmpty) ...[
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.mistDeep,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.qr_code_2,
                        size: 20,
                        color: AppColors.tealDeep,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          _barcodeValue,
                          style: AppTextStyles.monoCode,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  key: const Key('print-label'),
                  onPressed: _busy ? null : _printLabel,
                  icon: const Icon(Icons.print_outlined, size: 18),
                  label: const Text('Cetak Label'),
                ),
              ] else
                OutlinedButton.icon(
                  key: const Key('generate-barcode'),
                  onPressed: _busy ? null : _generateBarcode,
                  icon: const Icon(Icons.qr_code_2, size: 18),
                  label: const Text('Generate Barcode'),
                ),
            ],
          ),
        ],
      ],
    );
  }
}
