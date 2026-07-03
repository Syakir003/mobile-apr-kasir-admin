import 'package:firebase_auth/firebase_auth.dart' as fb;

import '../models/app_user.dart';

abstract interface class AuthRepository {
  Stream<AppUser?> watchCurrentUser();
  Future<void> signIn({required String email, required String password});
  Future<void> signOut();
}

class FirebaseAuthRepository implements AuthRepository {
  FirebaseAuthRepository(this._auth);
  final fb.FirebaseAuth _auth;

  @override
  Stream<AppUser?> watchCurrentUser() {
    return _auth.idTokenChanges().asyncMap((user) async {
      if (user == null) return null;
      final token = await user.getIdTokenResult();
      final role = UserRole.fromClaim(token.claims?['role']);
      if (role == null) return null; // akun tanpa role tidak boleh masuk
      return AppUser(
        uid: user.uid,
        email: user.email ?? '',
        displayName: user.displayName ?? '',
        role: role,
      );
    });
  }

  @override
  Future<void> signIn({required String email, required String password}) =>
      _auth.signInWithEmailAndPassword(email: email, password: password);

  @override
  Future<void> signOut() => _auth.signOut();
}
