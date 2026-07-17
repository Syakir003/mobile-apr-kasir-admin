import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/app_user.dart';

String _roleLabel(UserRole role) => switch (role) {
      UserRole.admin => 'Admin',
      UserRole.kasir => 'Kasir',
      UserRole.teknisi => 'Teknisi',
    };

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).value;
    return Scaffold(
      appBar: AppBar(title: const Text('Profil Saya')),
      body: user == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                _ProfileCard(user: user),
                const SizedBox(height: 16),
                const _SectionLabel('Informasi Akun'),
                _InfoCard(user: user),
                const SizedBox(height: 16),
                const _SectionLabel('Keamanan Akun'),
                _SecurityCard(),
                const SizedBox(height: 24),
                SizedBox(
                  height: 50,
                  child: OutlinedButton.icon(
                    onPressed: () =>
                        ref.read(authRepositoryProvider).signOut(),
                    icon: const Icon(Icons.logout, color: AppColors.red600),
                    label: const Text('Logout'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.red600,
                      side: const BorderSide(color: Color(0xFFFECACA)),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({required this.user});
  final AppUser user;

  @override
  Widget build(BuildContext context) {
    final initial = (user.displayName.trim().isEmpty
            ? (user.email.isEmpty ? '?' : user.email)
            : user.displayName.trim())
        .characters
        .first
        .toUpperCase();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                color: AppColors.teal100,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 4),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.slate900.withValues(alpha: 0.08),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              alignment: Alignment.center,
              child: Text(
                initial,
                style: const TextStyle(
                  color: AppColors.teal700,
                  fontSize: 40,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              user.displayName.isEmpty ? 'Pengguna' : user.displayName,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: AppColors.slate900,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              decoration: BoxDecoration(
                color: AppColors.slate100,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: AppColors.slate200),
              ),
              child: Text(
                'Role: ${_roleLabel(user.role)}',
                style: const TextStyle(
                  color: AppColors.slate600,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.user});
  final AppUser user;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Column(
          children: [
            _InfoRow(
                icon: Icons.person_outline,
                label: 'Nama',
                value: user.displayName.isEmpty ? '-' : user.displayName),
            const Divider(height: 1),
            _InfoRow(
                icon: Icons.mail_outline, label: 'Email', value: user.email),
            const Divider(height: 1),
            _InfoRow(
                icon: Icons.badge_outlined,
                label: 'Role',
                value: _roleLabel(user.role)),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(
        children: [
          Icon(icon, size: 20, color: AppColors.slate400),
          const SizedBox(width: 14),
          Text(label,
              style: const TextStyle(
                  color: AppColors.slate500, fontSize: 14)),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.slate900,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SecurityCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        leading: const CircleAvatar(
          backgroundColor: AppColors.teal50,
          child: Icon(Icons.lock_outline, color: AppColors.teal700),
        ),
        title: const Text('Ubah Password',
            style: TextStyle(fontWeight: FontWeight.w600)),
        subtitle: const Text('Ganti kata sandi akun Anda'),
        trailing: const Icon(Icons.chevron_right, color: AppColors.slate400),
        onTap: () => _showChangePasswordSheet(context),
      ),
    );
  }
}

void _showChangePasswordSheet(BuildContext context) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
    ),
    builder: (_) => const _ChangePasswordSheet(),
  );
}

class _ChangePasswordSheet extends StatefulWidget {
  const _ChangePasswordSheet();

  @override
  State<_ChangePasswordSheet> createState() => _ChangePasswordSheetState();
}

class _ChangePasswordSheetState extends State<_ChangePasswordSheet> {
  final _formKey = GlobalKey<FormState>();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await Supabase.instance.client.auth.updateUser(
        UserAttributes(password: _password.text),
      );
      if (!mounted) return;
      navigator.pop();
      messenger.showSnackBar(
        const SnackBar(content: Text('Password berhasil diperbarui.')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(
        SnackBar(
          content: Text('Gagal mengubah password: $e'),
          backgroundColor: AppColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + bottom),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Ubah Password',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: AppColors.slate900,
              ),
            ),
            const SizedBox(height: 4),
            const Text('Minimal 6 karakter.',
                style: TextStyle(color: AppColors.slate500)),
            const SizedBox(height: 20),
            TextFormField(
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Password Baru',
                prefixIcon: Icon(Icons.lock_outline),
              ),
              validator: (v) => (v == null || v.length < 6)
                  ? 'Minimal 6 karakter'
                  : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _confirm,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Konfirmasi Password',
                prefixIcon: Icon(Icons.lock_outline),
              ),
              validator: (v) =>
                  v != _password.text ? 'Password tidak sama' : null,
            ),
            const SizedBox(height: 20),
            SizedBox(
              height: 50,
              child: FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Simpan Password'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 10),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: AppColors.slate400,
        ),
      ),
    );
  }
}
