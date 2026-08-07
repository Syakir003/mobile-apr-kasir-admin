import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/form_field.dart';
import '../../../core/widgets/form_scaffold.dart';
import '../../../data/models/service_item.dart';
import '../master_providers.dart';
import '../../../core/utils/error_message.dart';

class ServiceFormScreen extends ConsumerStatefulWidget {
  const ServiceFormScreen({super.key, this.initial});

  final ServiceItem? initial;

  @override
  ConsumerState<ServiceFormScreen> createState() => _ServiceFormScreenState();
}

class _ServiceFormScreenState extends ConsumerState<ServiceFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _category;
  late final TextEditingController _basePrice;
  late final TextEditingController _duration;
  late final TextEditingController _description;
  late bool _active;
  bool _busy = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final s = widget.initial;
    _name = TextEditingController(text: s?.name ?? '');
    _category = TextEditingController(text: s?.category ?? '');
    _basePrice = TextEditingController(
      text: s == null ? '' : formatRupiahInput(s.basePrice),
    );
    _duration =
        TextEditingController(text: s?.durationMinutes?.toString() ?? '');
    _description = TextEditingController(text: s?.description ?? '');
    _active = s?.active ?? true;
  }

  @override
  void dispose() {
    _name.dispose();
    _category.dispose();
    _basePrice.dispose();
    _duration.dispose();
    _description.dispose();
    super.dispose();
  }

  String? _requiredValidator(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null;

  String? _intValidator(String? v, {bool required = true}) {
    if (v == null || v.trim().isEmpty) {
      return required ? 'Wajib diisi' : null;
    }
    return int.tryParse(v.trim()) == null ? 'Harus berupa angka' : null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final durText = _duration.text.trim();
    final descText = _description.text.trim();
    final service = ServiceItem(
      id: widget.initial?.id ?? '',
      name: _name.text.trim(),
      category: _category.text.trim(),
      basePrice: parseRupiahInput(_basePrice.text),
      durationMinutes: durText.isEmpty ? null : int.parse(durText),
      description: descText.isEmpty ? null : descText,
      active: _active,
    );
    final repo = ref.read(serviceRepositoryProvider);
    try {
      if (_isEdit) {
        await repo.update(widget.initial!.id, service);
      } else {
        await repo.create(service);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Jasa tersimpan.')),
      );
      context.go('/services');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Gagal menyimpan: ${errorMessage(e)}'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppFormScaffold(
      title: _isEdit ? 'Edit Jasa' : 'Tambah Jasa',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Simpan',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        AppFormCard(
          title: 'Detail Jasa',
          children: [
            AppTextField(
              key: const Key('name'),
              label: 'Nama',
              required: true,
              hint: 'Contoh: Cuci AC Split',
              controller: _name,
              enabled: !_busy,
              validator: _requiredValidator,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('category'),
              label: 'Kategori',
              required: true,
              controller: _category,
              enabled: !_busy,
              validator: _requiredValidator,
            ),
            const SizedBox(height: kFieldGap),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: AppMoneyField(
                    key: const Key('basePrice'),
                    label: 'Harga Dasar',
                    required: true,
                    controller: _basePrice,
                    enabled: !_busy,
                    validator: rupiahRequiredValidator,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppNumberField(
                    key: const Key('duration'),
                    label: 'Estimasi Durasi',
                    hint: '45',
                    suffixText: 'menit',
                    controller: _duration,
                    enabled: !_busy,
                    validator: (v) => _intValidator(v, required: false),
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('description'),
              label: 'Keterangan Singkat',
              hint: 'Deskripsi layanan atau rincian pekerjaan...',
              maxLines: 3,
              controller: _description,
              enabled: !_busy,
            ),
            const SizedBox(height: kFieldGap),
            AppSwitchTile(
              key: const Key('active'),
              title: 'Status Jasa Aktif',
              subtitle: 'Tampil di pilihan kasir dan teknisi',
              value: _active,
              onChanged: _busy ? null : (v) => setState(() => _active = v),
            ),
          ],
        ),
      ],
    );
  }
}
