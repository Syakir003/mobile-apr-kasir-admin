import 'dart:async';

import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/data/models/manual_payment.dart';
import 'package:epos_ac/data/repositories/invoice_repository.dart';

/// Implementasi in-memory dari [InvoiceRepository] untuk pengujian.
///
/// Pola sama dengan `FakeAcUnitRepository`: emit lewat broadcast
/// [StreamController] dengan seed awal via [scheduleMicrotask]. Item
/// tersimpan dengan `id` terisi (meniru `doc.id` Firestore).
class FakeInvoiceRepository implements InvoiceRepository {
  FakeInvoiceRepository({
    List<MapEntry<String, Invoice>>? invoices,
    List<MapEntry<String, ManualPayment>>? payments,
  }) {
    if (invoices != null) {
      for (final e in invoices) {
        _invoiceStore[e.key] = e.value.copyWith(id: e.key);
      }
    }
    if (payments != null) {
      for (final e in payments) {
        _paymentStore[e.key] = e.value.copyWith(id: e.key);
      }
    }
  }

  final Map<String, Invoice> _invoiceStore = {};
  final Map<String, ManualPayment> _paymentStore = {};
  final _invoiceController = StreamController<List<Invoice>>.broadcast();
  final _paymentController = StreamController<List<ManualPayment>>.broadcast();

  /// Snapshot invoice saat ini (nilai store, id terisi).
  List<Invoice> get invoiceItems => _invoiceStore.values.toList(growable: false);

  /// Snapshot pembayaran saat ini (nilai store, id terisi).
  List<ManualPayment> get paymentItems =>
      _paymentStore.values.toList(growable: false);

  @override
  Stream<List<Invoice>> watchAll() {
    scheduleMicrotask(() {
      if (!_invoiceController.isClosed) _invoiceController.add(invoiceItems);
    });
    return _invoiceController.stream;
  }

  @override
  Stream<Invoice?> watchById(String id) {
    scheduleMicrotask(() {
      if (!_invoiceController.isClosed) _invoiceController.add(invoiceItems);
    });
    return _invoiceController.stream.map((all) {
      for (final inv in all) {
        if (inv.id == id) return inv;
      }
      return null;
    });
  }

  @override
  Stream<List<ManualPayment>> watchPayments(String invoiceId) {
    scheduleMicrotask(() {
      if (!_paymentController.isClosed) _paymentController.add(paymentItems);
    });
    return _paymentController.stream.map(
      (all) =>
          all.where((p) => p.invoiceId == invoiceId).toList(growable: false),
    );
  }

  void dispose() {
    _invoiceController.close();
    _paymentController.close();
  }
}
