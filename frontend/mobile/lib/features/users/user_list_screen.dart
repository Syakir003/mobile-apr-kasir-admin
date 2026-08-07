import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/app_user.dart';
import '../../data/models/managed_user.dart';
import 'user_providers.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';

/// Daftar akun pengguna (admin). Nonaktif ditampilkan pudar tapi tetap
/// terlihat — akun tidak pernah dihapus, hanya dinonaktifkan.
class UserListScreen extends ConsumerWidget {
  const UserListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(managedUsersProvider);
    final meId = ref.watch(currentUserProvider).value?.uid;

    return Scaffold(
      appBar: AppBar(title: const Text('Manajemen Akun')),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('user-add-fab'),
        onPressed: () => context.go('/users/new'),
        icon: const Icon(Icons.person_add_alt),
        label: const Text('Akun Baru'),
      ),
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat akun'),
        data: (users) {
          if (users.isEmpty) {
            return const Center(
              child: Text('Belum ada akun.',
                  style: TextStyle(color: AppColors.slate500)),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
            itemCount: users.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (_, i) => _UserTile(
              user: users[i],
              isMe: users[i].id == meId,
              onTap: () => context.go('/users/${users[i].id}', extra: users[i]),
            ),
          );
        },
      ),
    );
  }
}

class _UserTile extends StatelessWidget {
  const _UserTile({
    required this.user,
    required this.isMe,
    required this.onTap,
  });

  final ManagedUser user;
  final bool isMe;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dim = !user.active;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Row(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor:
                    dim ? AppColors.slate100 : _roleColor(user.role).$2,
                child: Text(
                  user.label.characters.first.toUpperCase(),
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: dim ? AppColors.slate400 : _roleColor(user.role).$1,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            user.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color:
                                  dim ? AppColors.slate400 : AppColors.slate900,
                            ),
                          ),
                        ),
                        if (isMe) ...[
                          const SizedBox(width: 6),
                          const StatusBadge(
                            label: 'Anda',
                            color: AppColors.slate500,
                            showDot: false,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      user.email,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.slate500),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  StatusBadge(
                    label: user.roleLabel,
                    color: dim ? AppColors.slate400 : _roleColor(user.role).$1,
                    showDot: false,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    user.active ? 'Aktif' : 'Nonaktif',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: user.active ? AppColors.success : AppColors.danger,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// (warna teks, warna latar) per peran.
(Color, Color) _roleColor(UserRole? role) => switch (role) {
      UserRole.admin => (AppColors.teal700, AppColors.teal50),
      UserRole.kasir => (AppColors.slate700, AppColors.slate100),
      UserRole.teknisi => (AppColors.warning, AppColors.amberSurface),
      null => (AppColors.slate500, AppColors.slate100),
    };

