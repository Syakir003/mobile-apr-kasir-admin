import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../data/models/invoice.dart';
import '../../data/models/manual_payment.dart';
import '../../data/repositories/invoice_repository.dart';

final invoiceRepositoryProvider = Provider<InvoiceRepository>(
  (ref) => SupabaseInvoiceRepository(ref.watch(supabaseProvider)),
);

/// Daftar invoice terbaru (100 terakhir, urut created_at desc).
final invoicesStreamProvider = StreamProvider<List<Invoice>>(
  (ref) => ref.watch(invoiceRepositoryProvider).watchAll(),
);

/// Satu invoice by id (family). Null bila dokumen tidak ada.
final invoiceProvider = StreamProvider.family<Invoice?, String>(
  (ref, id) => ref.watch(invoiceRepositoryProvider).watchById(id),
);

/// Daftar pembayaran manual milik satu invoice (family by invoiceId).
final invoicePaymentsProvider = StreamProvider.family<List<ManualPayment>, String>(
  (ref, invoiceId) =>
      ref.watch(invoiceRepositoryProvider).watchPayments(invoiceId),
);

/// Memanggil RPC `record_payment` dengan payload mentah.
/// Dipisah sebagai provider agar mudah di-override fake pada widget test.
final recordPaymentCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('record_payment', params: {'payload': payload});
  };
});
