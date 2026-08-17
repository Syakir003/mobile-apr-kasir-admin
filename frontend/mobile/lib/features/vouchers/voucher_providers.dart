import 'package:flutter_riverpod/flutter_riverpod.dart';

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

/// RPC `create_voucher` (admin). Mengembalikan kode voucher yang dibuat.
final createVoucherCallerProvider =
    Provider<Future<String> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final result = await ref
        .read(supabaseProvider)
        .rpc('create_voucher', params: {'payload': payload});
    return (result as Map)['code'] as String? ?? '';
  };
});

/// RPC `cancel_voucher` (admin).
final cancelVoucherCallerProvider =
    Provider<Future<void> Function(String voucherId, {String? reason})>((ref) {
  return (voucherId, {reason}) async {
    await ref.read(supabaseProvider).rpc('cancel_voucher', params: {
      'payload': {'voucherId': voucherId, if (reason != null) 'reason': reason},
    });
  };
});
