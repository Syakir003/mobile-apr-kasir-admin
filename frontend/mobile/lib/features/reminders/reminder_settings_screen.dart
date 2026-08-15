import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/form_scaffold.dart';
import '../../core/widgets/notice_panel.dart';
import 'reminder_providers.dart';

/// Jenis pekerjaan yang punya siklus berulang. Sengaja dikunci di sini — RPC
/// `save_reminder_settings` menolak jenis lain ('pemasangan', 'bongkar',
/// 'service' sekali kerja, tidak ada servis berikutnya).
const _kJobTypes = ['cuci', 'maintenance'];

/// Pengaturan siklus servis default per jenis pekerjaan (admin).
///
/// Satuannya **bulan** di layar ini dan **hari** di database: pelanggan dan
/// admin bicara "dua bulan sekali", sedangkan `reminder_settings.interval_days`
/// memakai hari supaya tidak ada ambiguitas panjang bulan. Konversinya tetap
/// 30 hari per bulan, sama seperti [ReminderSetting.intervalMonths].
class ReminderSettingsScreen extends ConsumerStatefulWidget {
  const ReminderSettingsScreen({super.key});

  @override
  ConsumerState<ReminderSettingsScreen> createState() =>
      _ReminderSettingsScreenState();
}

class _ReminderSettingsScreenState
    extends ConsumerState<ReminderSettingsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _months = <String, TextEditingController>{};
  final _active = <String, bool>{};
  bool _loaded = false;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in _months.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// Isi form dari data server sekali saja — memuat ulang setiap build akan
  /// menimpa angka yang sedang diketik admin.
  void _hydrate(List<ReminderSetting> settings) {
    if (_loaded) return;
    for (final jobType in _kJobTypes) {
      ReminderSetting? s;
      for (final e in settings) {
        if (e.jobType == jobType) {
          s = e;
          break;
        }
      }
      _months[jobType] =
          TextEditingController(text: '${s?.intervalMonths ?? 2}');
      _active[jobType] = s?.active ?? true;
    }
    _loaded = true;
  }

  String? _validateMonths(String? v) {
    final n = int.tryParse((v ?? '').trim());
    if (n == null) return 'Wajib diisi angka';
    // 1–24 bulan = 30–720 hari, aman di dalam batas 7–730 hari milik RPC.
    if (n < 1 || n > 24) return 'Antara 1 dan 24 bulan';
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final save = ref.read(saveReminderSettingsCallerProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      for (final jobType in _kJobTypes) {
        final months = int.parse(_months[jobType]!.text.trim());
        await save(jobType, months * 30, _active[jobType] ?? true);
      }
      ref.invalidate(reminderSettingsProvider);
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Pengaturan pengingat tersimpan.')),
      );
      context.go('/pengingat');
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
    final async = ref.watch(reminderSettingsProvider);

    if (!async.hasValue) {
      return Scaffold(
        appBar: AppBar(title: const Text('Pengaturan Pengingat')),
        body: async.hasError
            ? AppErrorState(
                error: async.error!,
                title: 'Gagal memuat pengaturan',
                onRetry: () => ref.invalidate(reminderSettingsProvider),
              )
            : const AppSkeletonDetail(blocks: 2),
      );
    }
    _hydrate(async.requireValue);

    return AppFormScaffold(
      title: 'Pengaturan Pengingat',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Simpan',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        const NoticePanel(
          icon: Icons.info_outline,
          text: 'Perubahan berlaku untuk servis berikutnya. Jadwal yang sudah '
              'tercatat tidak ikut bergeser.',
        ),
        const SizedBox(height: AppSpacing.grid),
        for (final jobType in _kJobTypes) ...[
          AppFormCard(
            title: jobType == 'cuci' ? 'Cuci AC' : 'Maintenance',
            subtitle: 'Pelanggan diingatkan H-3 sebelum jatuh tempo, lalu '
                'sekali lagi 7 hari setelahnya bila belum memesan.',
            children: [
              AppTextField(
                key: Key('bulan-$jobType'),
                label: 'Siklus servis',
                required: true,
                controller: _months[jobType],
                enabled: !_busy && (_active[jobType] ?? true),
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                suffixText: 'bulan',
                validator: _validateMonths,
              ),
              const SizedBox(height: kFieldGap),
              SwitchListTile(
                key: Key('aktif-$jobType'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Aktifkan pengingat'),
                subtitle: const Text(
                  'Bila dimatikan, pekerjaan jenis ini tidak menjadwalkan '
                  'servis berikutnya sama sekali.',
                ),
                value: _active[jobType] ?? true,
                onChanged: _busy
                    ? null
                    : (v) => setState(() => _active[jobType] = v),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.grid),
        ],
      ],
    );
  }
}
