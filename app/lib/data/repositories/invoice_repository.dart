import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/invoice.dart';
import '../models/manual_payment.dart';

/// Kontrak akses invoice & pembayaran manual (koleksi `invoices` dan
/// `manual_payments`). Ditulis hanya oleh Cloud Functions (`checkoutTransaction`,
/// `recordPayment`); repositori ini murni untuk membaca.
abstract interface class InvoiceRepository {
  Stream<List<Invoice>> watchAll();
  Stream<Invoice?> watchById(String id);
  Stream<List<ManualPayment>> watchPayments(String invoiceId);
}

/// Implementasi [InvoiceRepository] di atas Firestore.
class FirestoreInvoiceRepository implements InvoiceRepository {
  FirestoreInvoiceRepository(this._db);

  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> get _invoiceCol =>
      _db.collection('invoices');

  CollectionReference<Map<String, dynamic>> get _paymentCol =>
      _db.collection('manual_payments');

  @override
  Stream<List<Invoice>> watchAll() {
    return _invoiceCol
        .orderBy('created_at', descending: true)
        .limit(100)
        .snapshots()
        .map(
          (snap) => snap.docs
              .map((doc) => Invoice.fromMap(doc.id, doc.data()))
              .toList(growable: false),
        );
  }

  @override
  Stream<Invoice?> watchById(String id) {
    return _invoiceCol.doc(id).snapshots().map((snap) {
      if (!snap.exists) return null;
      final data = snap.data();
      if (data == null) return null;
      return Invoice.fromMap(snap.id, data);
    });
  }

  @override
  Stream<List<ManualPayment>> watchPayments(String invoiceId) {
    return _paymentCol
        .where('invoice_id', isEqualTo: invoiceId)
        .orderBy('created_at')
        .snapshots()
        .map(
          (snap) => snap.docs
              .map((doc) => ManualPayment.fromMap(doc.id, doc.data()))
              .toList(growable: false),
        );
  }
}
