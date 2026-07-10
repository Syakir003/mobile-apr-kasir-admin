import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/ac_unit.dart';
import '../../data/models/member.dart';
import '../../data/repositories/ac_unit_repository.dart';
import '../../data/repositories/crud_repository.dart';
import '../master/master_providers.dart' show firestoreProvider;

final memberRepositoryProvider = Provider<CrudRepository<Member>>((ref) {
  return FirestoreCrudRepository<Member>(
    ref.watch(firestoreProvider),
    'members',
    Member.fromMap,
    (m) => m.toMap(),
  );
});

final membersStreamProvider = StreamProvider<List<Member>>(
  (ref) => ref.watch(memberRepositoryProvider).watchAll(),
);

final acUnitRepositoryProvider = Provider<AcUnitRepository>(
  (ref) => FirestoreAcUnitRepository(ref.watch(firestoreProvider)),
);

/// Unit AC milik satu member (family by memberId).
final memberUnitsProvider = StreamProvider.family<List<AcUnit>, String>(
  (ref, memberId) =>
      ref.watch(acUnitRepositoryProvider).watchByMember(memberId),
);
