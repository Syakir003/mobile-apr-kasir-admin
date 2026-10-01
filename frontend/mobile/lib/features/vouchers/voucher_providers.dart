import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/utils/snake_keys.dart';
import '../../data/models/voucher.dart';

/// Semua voucher, terbaru dulu (`GET /vouchers`, admin/kasir). Dimuat sekali
/// per pembukaan layar; mutasi di bawah me-refetch lewat invalidate.
final vouchersStreamProvider = StreamProvider.autoDispose<List<Voucher>>((ref) async* {
  final rows = await const ApiClient().get('/vouchers') as List;
  yield [
    for (final r in rows)
      Voucher.fromMap((r as Map)['id'] as String, snakeKeys(r)),
  ];
});

/// `POST /vouchers` (admin) — pengganti RPC `create_voucher` pada migrasi
/// Flutter -> Nest. Payload sudah camelCase persis sama dengan
/// `CreateVoucherDto` (dibangun di `voucher_form_screen.dart`), jadi
/// diteruskan apa adanya tanpa adapter. Mengembalikan kode voucher yang
/// dibuat.
final createVoucherCallerProvider =
    Provider<Future<String> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final json = await const ApiClient().post('/vouchers', body: payload) as Map;
    ref.invalidate(vouchersStreamProvider);
    return json['code'] as String? ?? '';
  };
});

/// `POST /vouchers/:id/cancel` (admin) — pengganti RPC `cancel_voucher`.
final cancelVoucherCallerProvider =
    Provider<Future<void> Function(String voucherId, {String? reason})>((ref) {
  return (voucherId, {reason}) async {
    await const ApiClient().post('/vouchers/$voucherId/cancel', body: {
      if (reason != null) 'reason': reason,
    });
    ref.invalidate(vouchersStreamProvider);
  };
});
