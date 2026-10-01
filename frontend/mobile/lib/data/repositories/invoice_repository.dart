import '../../core/api/api_client.dart';
import '../../core/utils/snake_keys.dart';
import '../models/invoice.dart';
import '../models/manual_payment.dart';

/// Kontrak akses invoice & pembayaran manual. Murni membaca; penulisan lewat
/// `POST /pos/checkout` dan `POST /invoices/:id/payments`.
abstract interface class InvoiceRepository {
  Stream<List<Invoice>> watchAll();
  Stream<Invoice?> watchById(String id);
  Stream<List<ManualPayment>> watchPayments(String invoiceId);
}

/// [InvoiceRepository] lewat backend Nest. Dimuat sekali per pembacaan
/// (event `invoice.updated` backend hanya sampai ke room admin); pemanggil
/// me-refetch lewat `ref.invalidate(...)` setelah pembayaran.
class NestInvoiceRepository implements InvoiceRepository {
  const NestInvoiceRepository(this._api);

  final ApiClient _api;

  @override
  Stream<List<Invoice>> watchAll() async* {
    final res = await _api.get('/invoices?pageSize=100') as Map;
    yield [
      for (final r in res['items'] as List)
        Invoice.fromMap((r as Map)['id'] as String, snakeKeys(r)),
    ];
  }

  @override
  Stream<Invoice?> watchById(String id) async* {
    final res = await _fetch(id);
    if (res == null) {
      yield null;
      return;
    }
    final row = snakeKeys(res);
    row['items'] = [for (final i in res['items'] as List) snakeKeys(i as Map)];
    yield Invoice.fromMap(id, row);
  }

  @override
  Stream<List<ManualPayment>> watchPayments(String invoiceId) async* {
    final res = await _fetch(invoiceId);
    yield [
      for (final p in (res?['manualPayments'] as List?) ?? const [])
        ManualPayment.fromMap((p as Map)['id'] as String, snakeKeys(p)),
    ];
  }

  Future<Map<dynamic, dynamic>?> _fetch(String id) async {
    try {
      return await _api.get('/invoices/${Uri.encodeComponent(id)}') as Map;
    } on NestApiException catch (e) {
      if (e.statusCode == 404) return null;
      rethrow;
    }
  }
}
