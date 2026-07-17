import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/invoice.dart';
import '../models/manual_payment.dart';

/// Kontrak akses invoice & pembayaran manual (tabel `invoices`,
/// `invoice_items`, dan `manual_payments`). Ditulis hanya oleh RPC Postgres
/// (`checkout_transaction`, `record_payment`); repositori ini murni membaca.
abstract interface class InvoiceRepository {
  Stream<List<Invoice>> watchAll();
  Stream<Invoice?> watchById(String id);
  Stream<List<ManualPayment>> watchPayments(String invoiceId);
}

/// Implementasi [InvoiceRepository] di atas Supabase.
class SupabaseInvoiceRepository implements InvoiceRepository {
  SupabaseInvoiceRepository(this._client);

  final SupabaseClient _client;

  @override
  Stream<List<Invoice>> watchAll() {
    // Daftar tidak butuh item — layar list hanya menampilkan ringkasan.
    return _client
        .from('invoices')
        .stream(primaryKey: ['id'])
        .order('created_at', ascending: false)
        .limit(100)
        .map(
          (rows) => rows
              .map((row) => Invoice.fromMap(row['id'] as String, row))
              .toList(growable: false),
        );
  }

  @override
  Stream<Invoice?> watchById(String id) {
    // Baris invoice di-stream (total_paid/status berubah saat pembayaran);
    // item diambil ulang tiap emisi — snapshot item tidak pernah berubah
    // setelah checkout, jadi fetch ulang murah dan selalu konsisten.
    return _client
        .from('invoices')
        .stream(primaryKey: ['id'])
        .eq('id', id)
        .asyncMap((rows) async {
          if (rows.isEmpty) return null;
          final row = Map<String, dynamic>.from(rows.first);
          row['items'] =
              await _client.from('invoice_items').select().eq('invoice_id', id);
          return Invoice.fromMap(row['id'] as String, row);
        });
  }

  @override
  Stream<List<ManualPayment>> watchPayments(String invoiceId) {
    return _client
        .from('manual_payments')
        .stream(primaryKey: ['id'])
        .eq('invoice_id', invoiceId)
        .order('created_at', ascending: true)
        .map(
          (rows) => rows
              .map((row) => ManualPayment.fromMap(row['id'] as String, row))
              .toList(growable: false),
        );
  }
}
