import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../data/models/voucher.dart';

/// Semua voucher, terbaru dulu. RLS admin/kasir; teknisi dapat daftar kosong.
final vouchersStreamProvider = StreamProvider.autoDispose<List<Voucher>>((ref) {
  final client = ref.watch(supabaseProvider);
  return client
      .from('vouchers')
      .stream(primaryKey: ['id'])
      .order('created_at')
      .map((rows) {
        final list = [
          for (final r in rows) Voucher.fromMap(r['id'] as String, Map.from(r)),
        ];
        list.sort((a, b) =>
            (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
        return list;
      });
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
  };
});
