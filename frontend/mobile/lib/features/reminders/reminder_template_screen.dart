import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/form_scaffold.dart';
import '../../core/widgets/notice_panel.dart';
import '../../data/models/wa_message.dart';
import 'reminder_providers.dart';

/// Editor redaksi 3 pesan pengingat servis (admin).
///
/// Teks disimpan di `wa_reminder_templates` dengan placeholder `{nama}`,
/// `{unit}`, `{tanggal}` — `build_wa_body()` di Postgres menyubstitusinya saat
/// pesan diantrekan. Perubahan berlaku untuk pengingat berikutnya; pesan yang
/// sudah di antrean sudah dibekukan teksnya.
const _kEditableKinds = [
  WaKind.selesaiServis,
  WaKind.reminderH3,
  WaKind.reminderH7,
];

/// Kata kunci yang sah — dipakai validator (cermin `save_wa_reminder_templates`).
final _kKnownPlaceholders = RegExp(r'\{(nama|unit|tanggal)\}');
final _kAnyPlaceholder = RegExp(r'\{[^{}]*\}');

class ReminderTemplateScreen extends ConsumerStatefulWidget {
  const ReminderTemplateScreen({super.key});

  @override
  ConsumerState<ReminderTemplateScreen> createState() =>
      _ReminderTemplateScreenState();
}

class _ReminderTemplateScreenState
    extends ConsumerState<ReminderTemplateScreen> {
  final _formKey = GlobalKey<FormState>();
  final _controllers = <WaKind, TextEditingController>{};
  final _defaults = <WaKind, String>{};
  bool _loaded = false;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// Isi form dari server sekali saja — memuat ulang tiap build menimpa teks
  /// yang sedang diedit admin.
  void _hydrate(List<WaTemplate> templates) {
    if (_loaded) return;
    for (final kind in _kEditableKinds) {
      WaTemplate? t;
      for (final e in templates) {
        if (e.kind == kind) {
          t = e;
          break;
        }
      }
      _controllers[kind] = TextEditingController(text: t?.body ?? '');
      _defaults[kind] = t?.defaultBody ?? '';
    }
    _loaded = true;
  }

  String? _validate(String? v) {
    final s = (v ?? '').trim();
    if (s.isEmpty) return 'Teks pesan wajib diisi';
    if (s.length > 1000) return 'Maksimal 1000 karakter';
    final leftover = s.replaceAll(_kKnownPlaceholders, '').contains(_kAnyPlaceholder);
    if (leftover) {
      return 'Kata kunci tak dikenal. Hanya {nama}, {unit}, {tanggal}.';
    }
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final save = ref.read(saveWaTemplatesCallerProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await save({
        for (final kind in _kEditableKinds) kind: _controllers[kind]!.text.trim(),
      });
      ref.invalidate(waTemplatesProvider);
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Teks pesan pengingat tersimpan.')),
      );
      context.go('/pengingat/pengaturan');
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

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(waTemplatesProvider);

    if (!async.hasValue) {
      return Scaffold(
        appBar: AppBar(title: const Text('Teks Pesan Pengingat')),
        body: async.hasError
            ? AppErrorState(
                error: async.error!,
                title: 'Gagal memuat teks pesan',
                onRetry: () => ref.invalidate(waTemplatesProvider),
              )
            : const AppSkeletonDetail(blocks: 3),
      );
    }
    _hydrate(async.requireValue);

    return AppFormScaffold(
      title: 'Teks Pesan Pengingat',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Simpan',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        const NoticePanel(
          icon: Icons.info_outline,
          text: 'Kata kunci {nama}, {unit}, dan {tanggal} otomatis diganti '
              'saat pesan dikirim. Perubahan berlaku untuk pengingat '
              'berikutnya, bukan yang sudah di antrean.',
        ),
        const SizedBox(height: AppSpacing.grid),
        for (final kind in _kEditableKinds) ...[
          _TemplateCard(
            kind: kind,
            controller: _controllers[kind]!,
            busy: _busy,
            validator: _validate,
            onReset: () {
              _controllers[kind]!.text = _defaults[kind] ?? '';
              setState(() {});
            },
          ),
          const SizedBox(height: AppSpacing.grid),
        ],
      ],
    );
  }
}

class _TemplateCard extends StatefulWidget {
  const _TemplateCard({
    required this.kind,
    required this.controller,
    required this.busy,
    required this.validator,
    required this.onReset,
  });

  final WaKind kind;
  final TextEditingController controller;
  final bool busy;
  final String? Function(String?) validator;
  final VoidCallback onReset;

  @override
  State<_TemplateCard> createState() => _TemplateCardState();
}

class _TemplateCardState extends State<_TemplateCard> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChange);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  String get _title => switch (widget.kind) {
        WaKind.selesaiServis => 'Pesan: Selesai Servis',
        WaKind.reminderH3 => 'Pesan: Pengingat H-3',
        WaKind.reminderH7 => 'Pesan: Terlambat 7 Hari',
        _ => widget.kind.label,
      };

  /// Pratinjau dengan data contoh — tidak dikirim ke mana pun.
  String get _preview => widget.controller.text
      .replaceAll('{nama}', 'Budi Santoso')
      .replaceAll('{unit}',
          '- Panasonic 1/2 PK (Kamar Tamu)\n- Daikin 1 PK (Kamar Utama)')
      .replaceAll('{tanggal}', '15 September 2026');

  @override
  Widget build(BuildContext context) {
    return AppFormCard(
      title: _title,
      children: [
        AppTextField(
          fieldKey: Key('teks-${widget.kind.value}'),
          label: 'Isi pesan',
          required: true,
          controller: widget.controller,
          enabled: !widget.busy,
          maxLines: 7,
          keyboardType: TextInputType.multiline,
          helper: 'Kata kunci: {nama}, {unit}, {tanggal}',
          validator: widget.validator,
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: Key('reset-${widget.kind.value}'),
            onPressed: widget.busy ? null : widget.onReset,
            icon: const Icon(Icons.restore, size: 18),
            label: const Text('Reset ke bawaan'),
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'Pratinjau',
          style: TextStyle(
            fontFamily: AppFonts.body,
            fontSize: 12,
            height: 16 / 12,
            color: AppColors.textMuted,
          ),
        ),
        const SizedBox(height: 6),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.mist,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Text(
            _preview.trim().isEmpty ? '(kosong)' : _preview,
            style: const TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 13,
              height: 18 / 13,
              color: AppColors.textBody,
            ),
          ),
        ),
      ],
    );
  }
}
