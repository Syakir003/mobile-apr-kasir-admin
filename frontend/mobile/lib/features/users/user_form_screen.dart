import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../data/models/app_user.dart';
import '../../data/models/managed_user.dart';
import 'user_providers.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/form_scaffold.dart';
import '../../core/widgets/notice_panel.dart';

const _roleLabels = {
  UserRole.admin: 'Admin — akses penuh',
  UserRole.kasir: 'Kasir — POS, transaksi & order',
  UserRole.teknisi: 'Teknisi — job & scan',
};

/// Form akun. Mode BUAT (`initial == null`) memanggil Edge Function
/// `admin-users`; mode UBAH memanggil RPC `update_user_account`. Email tidak
/// bisa diubah setelah akun dibuat — itu identitas login di `auth.users`.
class UserFormScreen extends ConsumerStatefulWidget {
  const UserFormScreen({super.key, this.userId, this.initial});

  /// Diisi saat membuka lewat '/users/:id'. Null = mode buat.
  final String? userId;

  /// Data awal dari `extra` router; bila null dicari dari daftar realtime.
  final ManagedUser? initial;

  @override
  ConsumerState<UserFormScreen> createState() => _UserFormScreenState();
}

class _UserFormScreenState extends ConsumerState<UserFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _displayName = TextEditingController();
  UserRole _role = UserRole.kasir;
  bool _active = true;
  bool _busy = false;

  /// Sekali saja: isi field dari data yang ditemukan (data bisa tiba belakangan
  /// lewat stream, jadi jangan timpa ketikan user setelah itu).
  bool _seeded = false;

  bool get _isCreate => widget.userId == null;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _displayName.dispose();
    super.dispose();
  }

  void _seed(ManagedUser u) {
    if (_seeded) return;
    _seeded = true;
    _email.text = u.email;
    _displayName.text = u.displayName;
    _role = u.role ?? UserRole.kasir;
    _active = u.active;
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    try {
      if (_isCreate) {
        await ref.read(createUserAccountCallerProvider)({
          'email': _email.text.trim(),
          'password': _password.text,
          'displayName': _displayName.text.trim(),
          'role': _role.name,
        });
        messenger.showSnackBar(
          const SnackBar(content: Text('Akun dibuat.')),
        );
      } else {
        await ref.read(updateUserAccountCallerProvider)({
          'userId': widget.userId,
          'role': _role.name,
          'active': _active,
          'displayName': _displayName.text.trim(),
        });
        messenger.showSnackBar(
          const SnackBar(content: Text('Akun diperbarui.')),
        );
      }
      router.pop();
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(errorMessage(e)),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resetPassword() async {
    final controller = TextEditingController();
    final newPassword = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Reset Password'),
        content: SizedBox(
          // Dialog Material melebar mengikuti isinya; tanpa lebar tetap,
          // kolomnya menyusut sampai labelnya terpotong.
          width: 320,
          child: AppPasswordField(
            label: 'Password baru',
            required: true,
            hint: 'Minimal 6 karakter',
            controller: controller,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text),
            child: const Text('Simpan'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (newPassword == null || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    if (newPassword.length < 6) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Password minimal 6 karakter'),
        backgroundColor: AppColors.danger,
      ));
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(resetPasswordCallerProvider)(widget.userId!, newPassword);
      messenger.showSnackBar(
        const SnackBar(content: Text('Password direset.')),
      );
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(errorMessage(e)),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final meId = ref.watch(currentUserProvider).value?.uid;
    final isSelf = !_isCreate && widget.userId == meId;

    ManagedUser? existing = widget.initial;
    if (!_isCreate) {
      // `extra` hilang saat halaman dibuka lewat deep link / reload web.
      existing ??= ref
          .watch(managedUsersProvider)
          .value
          ?.where((u) => u.id == widget.userId)
          .cast<ManagedUser?>()
          .firstOrNull;
      if (existing == null) {
        return Scaffold(
          appBar: AppBar(title: const Text('Ubah Akun')),
          body: const AppSkeletonDetail(),
        );
      }
      _seed(existing);
    }

    return AppFormScaffold(
      title: _isCreate ? 'Akun Baru' : 'Ubah Akun',
      formKey: _formKey,
      busy: _busy,
      submitLabel: _isCreate ? 'Buat Akun' : 'Simpan Perubahan',
      submitKey: const Key('user-submit'),
      onSubmit: _submit,
      secondary: _isCreate
          ? null
          : OutlinedButton.icon(
              key: const Key('user-reset-password'),
              onPressed: _busy ? null : _resetPassword,
              icon: const Icon(Icons.lock_reset, size: 18),
              label: const Text('Reset'),
            ),
      children: [
        AppFormCard(
          title: 'Kredensial',
          children: [
            AppTextField(
              fieldKey: const Key('user-email'),
              label: 'Email',
              required: _isCreate,
              hint: 'nama@contoh.com',
              helper: _isCreate
                  ? null
                  : 'Email login tidak bisa diubah dari sini.',
              controller: _email,
              enabled: _isCreate && !_busy,
              keyboardType: TextInputType.emailAddress,
              prefixIcon: const Icon(Icons.mail_outline, size: 18),
              validator: (v) {
                if (!_isCreate) return null;
                final value = (v ?? '').trim();
                if (value.isEmpty) return 'Email wajib diisi';
                if (!value.contains('@') || value.startsWith('@')) {
                  return 'Format email tidak valid';
                }
                return null;
              },
            ),
            if (_isCreate) ...[
              const SizedBox(height: kFieldGap),
              AppPasswordField(
                fieldKey: const Key('user-password'),
                label: 'Password',
                required: true,
                hint: 'Minimal 6 karakter',
                controller: _password,
                enabled: !_busy,
                validator: (v) => (v ?? '').length < 6
                    ? 'Password minimal 6 karakter'
                    : null,
              ),
            ],
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Identitas & Akses',
          children: [
            AppTextField(
              fieldKey: const Key('user-name'),
              label: 'Nama Tampilan',
              required: true,
              hint: 'Mis. Budi Santoso',
              controller: _displayName,
              enabled: !_busy,
              validator: (v) =>
                  (v ?? '').trim().isEmpty ? 'Nama wajib diisi' : null,
            ),
            const SizedBox(height: kFieldGap),
            AppSelectField<UserRole>(
              fieldKey: const Key('user-role'),
              label: 'Peran',
              required: true,
              value: _role,
              items: [
                for (final r in UserRole.values)
                  DropdownMenuItem(value: r, child: Text(_roleLabels[r]!)),
              ],
              onChanged: (_busy || isSelf)
                  ? null
                  : (v) => setState(() => _role = v!),
            ),
            if (isSelf) ...[
              const SizedBox(height: 12),
              const NoticePanel(
                icon: Icons.lock_outline,
                text: 'Peran & status akun sendiri tidak bisa diubah, '
                    'supaya Anda tidak terkunci keluar dari sistem.',
              ),
            ],
            if (!_isCreate) ...[
              const SizedBox(height: kFieldGap),
              AppSwitchTile(
                key: const Key('user-active'),
                title: 'Akun aktif',
                subtitle: _active
                    ? 'Bisa login dan memakai aplikasi.'
                    : 'Kehilangan peran pada token berikutnya — tidak bisa '
                        'memakai aplikasi.',
                value: _active,
                onChanged: (_busy || isSelf)
                    ? null
                    : (v) => setState(() => _active = v),
              ),
            ],
          ],
        ),
      ],
    );
  }
}
