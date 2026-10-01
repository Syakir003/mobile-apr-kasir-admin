import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/supabase/session_gate.dart';
import '../../data/models/invoice.dart';
import '../../data/models/manual_payment.dart';
import '../../data/repositories/invoice_repository.dart';

final invoiceRepositoryProvider = Provider<InvoiceRepository>(
  (ref) => const NestInvoiceRepository(ApiClient()),
);

/// Daftar invoice terbaru (100 terakhir, urut created_at desc).
final invoicesStreamProvider = StreamProvider.autoDispose<List<Invoice>>(
  (ref) => streamWhenSignedIn(
      ref, () => ref.watch(invoiceRepositoryProvider).watchAll()),
);

/// Satu invoice by id (family). Null bila dokumen tidak ada.
final invoiceProvider = StreamProvider.autoDispose.family<Invoice?, String>(
  (ref, id) => streamWhenSignedIn(
      ref, () => ref.watch(invoiceRepositoryProvider).watchById(id)),
);

/// Daftar pembayaran manual milik satu invoice (family by invoiceId).
final invoicePaymentsProvider =
    StreamProvider.autoDispose.family<List<ManualPayment>, String>(
  (ref, invoiceId) => streamWhenSignedIn(
      ref, () => ref.watch(invoiceRepositoryProvider).watchPayments(invoiceId)),
);

/// Memanggil `POST /invoices/:id/payments` (dulu RPC `record_payment` dengan
/// payload jsonb `{invoiceId, method, amount, cashReceived?, note?}` — lihat
/// [buildRecordPaymentBody] untuk pemetaan ke bentuk `RecordPaymentDto` Nest).
/// Dipisah sebagai provider agar mudah di-override fake pada widget test.
final recordPaymentCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  const api = ApiClient();
  return (payload) async {
    await sendRecordPayment(api.post, payload);
    final id = payload['invoiceId'] as String;
    ref.invalidate(invoiceProvider(id));
    ref.invalidate(invoicePaymentsProvider(id));
    ref.invalidate(invoicesStreamProvider);
  };
});

/// Dipisah dari [recordPaymentCallerProvider] agar testable tanpa jaringan — [post] adalah `ApiClient.post` sungguhan atau fake pada
/// test. [payload] masih memakai bentuk lama yang dibuat
/// `payment_form_sheet.dart` (`invoiceId` di dalamnya); [buildRecordPaymentBody]
/// yang memetakannya ke body Nest.
Future<void> sendRecordPayment(
  Future<dynamic> Function(String path, {Object? body}) post,
  Map<String, dynamic> payload,
) async {
  final invoiceId = payload['invoiceId'] as String;
  await post(
    '/invoices/$invoiceId/payments',
    body: buildRecordPaymentBody(payload),
  );
}

/// Memetakan payload lama (`invoiceId`, `method`, `amount`, `cashReceived?`,
/// `note?`) ke bentuk `RecordPaymentDto` Nest (`method`, `amount`, `note?`,
/// `proofUrl?`) — nama field sudah sama-sama camelCase, tinggal `invoiceId`
/// yang pindah ke path URL (dibuang di sini).
///
/// PENTING — mismatch yang belum terselesaikan di sisi Nest: `RecordPaymentDto`
/// (Nest/epos-backend/src/payments/dto/record-payment.dto.ts) belum punya
/// field `cashReceived`, padahal kolom `cash_received` sudah ada di
/// `manual_payments` (lihat `ManualPayment` schema.prisma) dan dipakai
/// `receipt_pdf.dart` untuk mencetak kembalian. `cashReceived` DIBUANG di
/// sini (bukan dikirim lalu di-whitelist-strip Nest secara senyap) supaya
/// jelas: kembalian tunai untuk sementara TIDAK tersimpan lewat endpoint ini.
Map<String, dynamic> buildRecordPaymentBody(Map<String, dynamic> payload) {
  final body = <String, dynamic>{
    'method': payload['method'],
    'amount': payload['amount'],
  };
  if (payload['note'] != null) body['note'] = payload['note'];
  if (payload['proofUrl'] != null) body['proofUrl'] = payload['proofUrl'];
  return body;
}
