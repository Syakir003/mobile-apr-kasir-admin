import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../data/models/service_item.dart';
import '../master_providers.dart';

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
    _basePrice = TextEditingController(text: s == null ? '' : '${s.basePrice}');
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
      basePrice: int.parse(_basePrice.text.trim()),
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
          content: Text('Gagal menyimpan: $e'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit Jasa' : 'Tambah Jasa')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              key: const Key('name'),
              controller: _name,
              decoration: const InputDecoration(labelText: 'Nama'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('category'),
              controller: _category,
              decoration: const InputDecoration(labelText: 'Kategori'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('basePrice'),
              controller: _basePrice,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Harga Dasar'),
              validator: (v) => _intValidator(v),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('duration'),
              controller: _duration,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Durasi (menit, opsional)',
              ),
              validator: (v) => _intValidator(v, required: false),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('description'),
              controller: _description,
              maxLines: 3,
              decoration:
                  const InputDecoration(labelText: 'Deskripsi (opsional)'),
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              key: const Key('active'),
              title: const Text('Aktif'),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
            const SizedBox(height: 24),
            FilledButton(
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
          ],
        ),
      ),
    );
  }
}
