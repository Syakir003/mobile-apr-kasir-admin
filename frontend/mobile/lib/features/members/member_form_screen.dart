import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/phone.dart';
import '../../data/models/member.dart';
import 'member_providers.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/form_scaffold.dart';

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
          content: Text('Gagal menyimpan: ${errorMessage(e)}'),
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
    return AppFormScaffold(
      title: _isEdit ? 'Edit Member' : 'Tambah Member',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Simpan',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        AppFormCard(
          title: 'Data Pelanggan',
          children: [
            AppTextField(
              key: const Key('name'),
              label: 'Nama',
              required: true,
              hint: 'Nama pelanggan atau perusahaan',
              controller: _name,
              enabled: !_busy,
              validator: _requiredValidator,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('phone'),
              label: 'Nomor HP',
              required: true,
              hint: '08xxxxxxxxxx',
              helper: 'Disimpan dalam format +628xxxxxxxx',
              keyboardType: TextInputType.phone,
              prefixIcon: const Icon(Icons.phone_outlined, size: 18),
              controller: _phone,
              enabled: !_busy,
              validator: _phoneValidator,
            ),
            const SizedBox(height: kFieldGap),
            AppSelectField<String>(
              key: const Key('customerType'),
              label: 'Jenis Pelanggan',
              required: true,
              value: _customerType,
              enabled: !_busy,
              items: [
                for (final t in kCustomerTypes)
                  DropdownMenuItem(value: t, child: Text(t)),
              ],
              onChanged: (v) =>
                  setState(() => _customerType = v ?? _customerType),
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('address'),
              label: 'Alamat',
              hint: 'Alamat pemasangan atau penagihan',
              maxLines: 2,
              controller: _address,
              enabled: !_busy,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('notes'),
              label: 'Catatan',
              hint: 'Preferensi jadwal, patokan lokasi, dll.',
              maxLines: 3,
              controller: _notes,
              enabled: !_busy,
            ),
            const SizedBox(height: kFieldGap),
            AppSwitchTile(
              key: const Key('active'),
              title: 'Member Aktif',
              subtitle: 'Bisa dipilih saat transaksi dan order servis.',
              value: _active,
              onChanged: _busy ? null : (v) => setState(() => _active = v),
            ),
          ],
        ),
      ],
    );
  }
}
