import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/session_gate.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../data/models/ac_unit.dart';
import '../../data/models/member.dart';
import '../../data/repositories/ac_unit_repository.dart';
import '../../data/repositories/crud_repository.dart';

final memberRepositoryProvider = Provider<CrudRepository<Member>>((ref) {
  return SupabaseCrudRepository<Member>(
    ref.watch(supabaseProvider),
    'members',
    Member.fromMap,
    (m) => m.toMap(),
  );
});

final membersStreamProvider = StreamProvider<List<Member>>(
  (ref) => streamWhenSignedIn(
      ref, () => ref.watch(memberRepositoryProvider).watchAll()),
);

final acUnitRepositoryProvider = Provider<AcUnitRepository>(
  (ref) => SupabaseAcUnitRepository(ref.watch(supabaseProvider)),
);

/// Unit AC milik satu member (family by memberId).
final memberUnitsProvider = StreamProvider.family<List<AcUnit>, String>(
  (ref, memberId) => streamWhenSignedIn(ref,
      () => ref.watch(acUnitRepositoryProvider).watchByMember(memberId)),
);

/// Satu unit AC by id (family). Dipakai layar riwayat service yang dapat
/// dibuka tanpa membawa objek unit (dari detail job / hasil scan).
final acUnitProvider = FutureProvider.autoDispose.family<AcUnit?, String>(
  (ref, unitId) => ref.watch(acUnitRepositoryProvider).findById(unitId),
);

/// Memanggil RPC `generate_ac_unit_barcode` untuk sebuah unit.
/// Dipisah sebagai provider agar mudah di-override fake pada widget test.
final acUnitBarcodeGeneratorProvider =
    Provider<Future<String> Function(String unitId)>((ref) {
  return (unitId) async {
    final result = await ref
        .read(supabaseProvider)
        .rpc('generate_ac_unit_barcode', params: {'p_unit_id': unitId});
    return ((result as Map)['barcode'] as String?) ?? '';
  };
});
