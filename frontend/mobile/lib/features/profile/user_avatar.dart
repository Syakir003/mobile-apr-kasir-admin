import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/app_user.dart';
import '../jobs/job_providers.dart' show signedPhotoUrlProvider;

/// Foto profil bulat (URL bertanda tangan dari `/uploads/sign`) atau inisial
/// nama bila belum ada foto / gagal dimuat.
class UserAvatar extends ConsumerWidget {
  const UserAvatar({
    super.key,
    required this.user,
    this.size = 48,
    this.background = AppColors.teal100,
    this.foreground = AppColors.teal700,
  });

  final AppUser user;
  final double size;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final name =
        user.displayName.trim().isEmpty ? user.email : user.displayName.trim();
    final initial = Text(
      name.isEmpty ? '?' : name.characters.first.toUpperCase(),
      style: TextStyle(
          color: foreground,
          fontSize: size * 0.42,
          fontWeight: FontWeight.bold),
    );
    final path = user.avatarPath;
    final url =
        path == null ? null : ref.watch(signedPhotoUrlProvider(path)).value;
    return Container(
      width: size,
      height: size,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: background, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: url == null
          ? initial
          : Image.network(url,
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => initial),
    );
  }
}
