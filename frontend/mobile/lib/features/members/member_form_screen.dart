import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/phone.dart';
import '../../data/models/member.dart';
import 'member_providers.dart';

class MemberFormScreen extends ConsumerStatefulWidget {
  const MemberFormScreen({super.key, this.initial});

  final Member? initial;

  @override
  ConsumerState<MemberFormScreen> createState() => _MemberFormScreenState();
}

class _MemberFormScreenState extends ConsumerState<MemberFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _address;
  late final TextEditingController _notes;
  late String _customerType;
  late bool _active;
  bool _busy = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final m = widget.initial;
    _name = TextEditingController(text: m?.name ?? '');
    _phone = TextEditingController(text: m?.phone ?? '');
    _address = TextEditingController(text: m?.address ?? '');
    _notes = TextEditingController(text: m?.notes ?? '');
    _customerType = m?.customerType ?? kCustomerTypes.first;
    _active = m?.active ?? true;
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _address.dispose();
    _notes.dispose();
    super.dispose();
  }

  String? _requiredValidator(String? v) =>
      (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null;

  String? _phoneValidator(String? v) {
    if (v == null || v.trim().isEmpty) return 'Wajib diisi';
    // Cek duplikat dari snapshot list yang sudah di-watch (cukup untuk MVP).
    // Keunikan keras dijamin di sisi server oleh Function checkout Fase 4.
    final normalized = normalizePhone(v.trim());
    final members =
        ref.read(membersStreamProvider).value ?? const <Member>[];
    final duplicate = members.any(
      (m) => m.phone == normalized && m.id != (widget.initial?.id ?? ''),
    );
    return duplicate ? 'Nomor HP sudah terdaftar' : null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final notesText = _notes.text.trim();
    final member = Member(
      id: widget.initial?.id ?? '',
      name: _name.text.trim(),
      phone: normalizePhone(_phone.text.trim()),
      address: _address.text.trim(),
      customerType: _customerType,
      memberSince: widget.initial?.memberSince,
      totalAcUnits: widget.initial?.totalAcUnits ?? 0,
      notes: notesText.isEmpty ? null : notesText,
      active: _active,
    );
    final repo = ref.read(memberRepositoryProvider);
    try {
      if (_isEdit) {
        await repo.update(widget.initial!.id, member);
      } else {
        await repo.create(member);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Member tersimpan.')),
      );
      context.go('/members');
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
    // Jaga langganan stream members tetap hidup supaya snapshot untuk
    // cek duplikat nomor HP di validator sudah terisi saat submit.
    ref.watch(membersStreamProvider);
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit Member' : 'Tambah Member')),
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
              key: const Key('name'),
              controller: _name,
              decoration: const InputDecoration(labelText: 'Nama'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('phone'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Nomor HP',
                helperText: 'Disimpan dalam format +628xxxxxxxx',
              ),
              validator: _phoneValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('address'),
              controller: _address,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Alamat'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const Key('customerType'),
              initialValue: _customerType,
              decoration: const InputDecoration(labelText: 'Jenis Pelanggan'),
              items: [
                for (final t in kCustomerTypes)
                  DropdownMenuItem(value: t, child: Text(t)),
              ],
              onChanged: (v) => setState(() => _customerType = v ?? _customerType),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('notes'),
              controller: _notes,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Catatan (opsional)'),
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              key: const Key('active'),
              title: const Text('Aktif'),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
            const SizedBox(height: 24),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
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
