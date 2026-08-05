import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/app_user.dart';
import '../../data/models/managed_user.dart';
import 'user_providers.dart';

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
        content: Text('$e'.replaceFirst('Exception: ', '')),
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
        content: TextField(
          controller: controller,
          obscureText: true,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Password baru',
            hintText: 'Minimal 6 karakter',
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
        content: Text('$e'.replaceFirst('Exception: ', '')),
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
          body: const Center(child: CircularProgressIndicator()),
        );
      }
      _seed(existing);
    }

    return Scaffold(
      appBar: AppBar(title: Text(_isCreate ? 'Akun Baru' : 'Ubah Akun')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
          children: [
            _label('Email'),
            TextFormField(
              key: const Key('user-email'),
              controller: _email,
              enabled: _isCreate && !_busy,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              decoration: InputDecoration(
                hintText: 'nama@contoh.com',
                helperText: _isCreate
                    ? null
                    : 'Email login tidak bisa diubah dari sini.',
              ),
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
            const SizedBox(height: 16),
            if (_isCreate) ...[
              _label('Password'),
              TextFormField(
                key: const Key('user-password'),
                controller: _password,
                enabled: !_busy,
                obscureText: true,
                decoration:
                    const InputDecoration(hintText: 'Minimal 6 karakter'),
                validator: (v) => (v ?? '').length < 6
                    ? 'Password minimal 6 karakter'
                    : null,
              ),
              const SizedBox(height: 16),
            ],
            _label('Nama Tampilan'),
            TextFormField(
              key: const Key('user-name'),
              controller: _displayName,
              enabled: !_busy,
              decoration: const InputDecoration(hintText: 'Mis. Budi Santoso'),
              validator: (v) =>
                  (v ?? '').trim().isEmpty ? 'Nama wajib diisi' : null,
            ),
            const SizedBox(height: 16),
            _label('Peran'),
            DropdownButtonFormField<UserRole>(
              key: const Key('user-role'),
              initialValue: _role,
              isExpanded: true,
              decoration: const InputDecoration(),
              items: [
                for (final r in UserRole.values)
                  DropdownMenuItem(value: r, child: Text(_roleLabels[r]!)),
              ],
              onChanged: (_busy || isSelf)
                  ? null
                  : (v) => setState(() => _role = v!),
            ),
            if (isSelf)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: _Hint(
                    'Peran & status akun sendiri tidak bisa diubah, supaya '
                    'Anda tidak terkunci keluar dari sistem.'),
              ),
            if (!_isCreate) ...[
              const SizedBox(height: 8),
              SwitchListTile(
                key: const Key('user-active'),
                value: _active,
                onChanged: (_busy || isSelf)
                    ? null
                    : (v) => setState(() => _active = v),
                title: const Text('Akun aktif'),
                subtitle: Text(_active
                    ? 'Bisa login dan memakai aplikasi.'
                    : 'Kehilangan peran pada token berikutnya — tidak bisa '
                        'memakai aplikasi.'),
                contentPadding: EdgeInsets.zero,
              ),
            ],
            const SizedBox(height: 24),
            SizedBox(
              height: 52,
              child: FilledButton.icon(
                key: const Key('user-submit'),
                onPressed: _busy ? null : _submit,
                icon: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.check),
                label: Text(_isCreate ? 'Buat Akun' : 'Simpan Perubahan'),
              ),
            ),
            if (!_isCreate) ...[
              const SizedBox(height: 12),
              SizedBox(
                height: 48,
                child: OutlinedButton.icon(
                  key: const Key('user-reset-password'),
                  onPressed: _busy ? null : _resetPassword,
                  icon: const Icon(Icons.lock_reset),
                  label: const Text('Reset Password'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(text,
            style: const TextStyle(
                fontWeight: FontWeight.w600, color: AppColors.slate700)),
      );
}

class _Hint extends StatelessWidget {
  const _Hint(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.slate100,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Text(text, style: const TextStyle(color: AppColors.slate500)),
    );
  }
}
