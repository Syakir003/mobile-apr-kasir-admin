import '../../data/models/app_user.dart';

String? computeRedirect({
  required AppUser? user,
  required bool loading,
  required String location,
}) {
  if (loading) return null;
  final loggedIn = user != null;
  final atLogin = location == '/login';
  if (!loggedIn) return atLogin ? null : '/login';
  if (atLogin) return '/';
  return null;
}
