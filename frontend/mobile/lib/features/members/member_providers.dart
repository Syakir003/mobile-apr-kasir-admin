import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/supabase/session_gate.dart';
import '../../data/models/ac_unit.dart';
import '../../data/models/member.dart';
import '../../data/repositories/ac_unit_repository.dart';
import '../../data/repositories/crud_repository.dart';
import '../../data/repositories/member_repository.dart';

final memberRepositoryProvider = Provider<CrudRepository<Member>>((ref) {
  return const NestMemberRepository(ApiClient());
});

/// autoDispose: data dimuat ulang tiap layar dibuka (tanpa event realtime).
final membersStreamProvider = StreamProvider.autoDispose<List<Member>>(
  (ref) => streamWhenSignedIn(
      ref, () => ref.watch(memberRepositoryProvider).watchAll()),
);

final acUnitRepositoryProvider = Provider<AcUnitRepository>(
  (ref) => NestAcUnitRepository(const ApiClient()),
);

/// Unit AC milik satu member (family by memberId).
final memberUnitsProvider = StreamProvider.autoDispose.family<List<AcUnit>, String>(
  (ref, memberId) => streamWhenSignedIn(ref,
      () => ref.watch(acUnitRepositoryProvider).watchByMember(memberId)),
);

/// Satu unit AC by id (family). Dipakai layar riwayat service yang dapat
/// dibuka tanpa membawa objek unit (dari detail job / hasil scan).
final acUnitProvider = FutureProvider.autoDispose.family<AcUnit?, String>(
  (ref, unitId) => ref.watch(acUnitRepositoryProvider).findById(unitId),
);

/// Barcode sebuah unit. Backend sudah menggenerate barcode saat `POST
/// /ac-units`, jadi cukup dibaca dari `GET /ac-units/:id`.
/// Dipisah sebagai provider agar mudah di-override fake pada widget test.
final acUnitBarcodeGeneratorProvider =
    Provider<Future<String> Function(String unitId)>((ref) {
  return (unitId) async {
    final res = await const ApiClient().get('/ac-units/$unitId') as Map;
    return ((res['unit'] as Map)['barcodeValue'] as String?) ?? '';
  };
});
