import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/utils/num_parse.dart';

/// Tahap kedua checkout (QR per unit): kasir hanya checkout (unit "dijatah"),
/// gudang mengambil unit dari rak lalu men-scan QR-nya. Baru saat discan unit
/// resmi keluar dan stok berkurang. Padanan `/kasir-scan` di web.

int _int(Object? v) => numFromNest(v)?.toInt() ?? 0;
String? _str(Object? v) => v == null ? null : '$v';

class PendingInvoice {
  const PendingInvoice({
    required this.invoiceId,
    required this.invoiceNumber,
    this.customerName,
    this.createdAt,
    required this.pendingUnits,
  });

  final String invoiceId;
  final String invoiceNumber;
  final String? customerName;
  final DateTime? createdAt;
  final int pendingUnits;

  factory PendingInvoice.fromMap(Map<String, dynamic> m) => PendingInvoice(
        invoiceId: '${m['invoiceId']}',
        invoiceNumber: '${m['invoiceNumber']}',
        customerName: _str(m['customerName']),
        createdAt: DateTime.tryParse('${m['createdAt']}')?.toLocal(),
        pendingUnits: _int(m['pendingUnits']),
      );
}

class FulfillmentLine {
  const FulfillmentLine({
    required this.refId,
    required this.productName,
    this.acRole,
    this.pairName,
    required this.qtyTotal,
    required this.qtyFulfilled,
    required this.qtyRemaining,
  });

  final String refId;
  final String productName;

  /// 'indoor' | 'outdoor' | null (produk non-AC / bukan paket).
  final String? acRole;
  final String? pairName;
  final int qtyTotal;
  final int qtyFulfilled;
  final int qtyRemaining;

  factory FulfillmentLine.fromMap(Map<String, dynamic> m) => FulfillmentLine(
        refId: '${m['refId']}',
        productName: '${m['productName']}',
        acRole: _str(m['acRole']),
        pairName: _str(m['pairName']),
        qtyTotal: _int(m['qtyTotal']),
        qtyFulfilled: _int(m['qtyFulfilled']),
        qtyRemaining: _int(m['qtyRemaining']),
      );
}

class InvoiceFulfillment {
  const InvoiceFulfillment({
    required this.invoiceId,
    required this.invoiceNumber,
    this.customerName,
    required this.lines,
  });

  final String invoiceId;
  final String invoiceNumber;
  final String? customerName;
  final List<FulfillmentLine> lines;

  int get totalUnits => lines.fold(0, (a, l) => a + l.qtyTotal);
  int get doneUnits => lines.fold(0, (a, l) => a + l.qtyFulfilled);
  bool get allDone => totalUnits > 0 && doneUnits == totalUnits;

  factory InvoiceFulfillment.fromMap(Map<String, dynamic> m) =>
      InvoiceFulfillment(
        invoiceId: '${m['invoiceId']}',
        invoiceNumber: '${m['invoiceNumber']}',
        customerName: _str(m['customerName']),
        lines: [
          for (final l in (m['lines'] as List? ?? const []))
            FulfillmentLine.fromMap(Map<String, dynamic>.from(l as Map)),
        ],
      );
}

class FulfillResult {
  const FulfillResult({
    this.unitCode,
    this.productName,
    this.acRole,
    this.swapped = false,
    this.releasedUnitCode,
  });

  final String? unitCode;
  final String? productName;
  final String? acRole;

  /// Unit yang discan menggantikan jatah unit lain (yang dikembalikan ke stok).
  final bool swapped;
  final String? releasedUnitCode;

  factory FulfillResult.fromMap(Map<String, dynamic> m) => FulfillResult(
        unitCode: _str(m['unitCode']),
        productName: _str(m['productName']),
        acRole: _str(m['acRole']),
        swapped: m['swapped'] == true,
        releasedUnitCode: _str(m['releasedUnitCode']),
      );

  String get _roleSuffix => acRole == 'indoor'
      ? ' (Indoor)'
      : acRole == 'outdoor'
          ? ' (Outdoor)'
          : '';

  /// Kalimat hasil untuk banner; [manual] = ditandai tanpa scan.
  String message({bool manual = false}) =>
      '${unitCode ?? 'Unit'}${productName == null ? '' : ' · $productName'}'
      '$_roleSuffix ${manual ? 'ditandai keluar (manual)' : 'sudah keluar'}';

  String? get swapNote => swapped
      ? 'Menggantikan jatah ${releasedUnitCode ?? 'unit lain'}, yang dikembalikan ke stok.'
      : null;
}

/// Pemanggil API; dipisah supaya mudah di-override fake di test.
class KeluarGudangApi {
  const KeluarGudangApi();

  Future<FulfillResult> scan(String invoiceId, String code) async {
    final json = await const ApiClient().post('/kasir-scan/scan',
        body: {'invoiceId': invoiceId, 'qrToken': code});
    return FulfillResult.fromMap(Map<String, dynamic>.from(json as Map));
  }

  Future<FulfillResult> manual(String invoiceId, String refId) async {
    final json = await const ApiClient().post('/kasir-scan/manual-fulfill',
        body: {'invoiceId': invoiceId, 'refId': refId});
    return FulfillResult.fromMap(Map<String, dynamic>.from(json as Map));
  }
}

final keluarGudangApiProvider =
    Provider<KeluarGudangApi>((ref) => const KeluarGudangApi());

final pendingInvoicesProvider =
    FutureProvider.autoDispose<List<PendingInvoice>>((ref) async {
  final rows = await const ApiClient().get('/kasir-scan/pending') as List;
  return [
    for (final r in rows)
      PendingInvoice.fromMap(Map<String, dynamic>.from(r as Map)),
  ];
});

final invoiceFulfillmentProvider = FutureProvider.autoDispose
    .family<InvoiceFulfillment, String>((ref, invoiceId) async {
  final json = await const ApiClient().get('/kasir-scan/invoices/$invoiceId');
  return InvoiceFulfillment.fromMap(Map<String, dynamic>.from(json as Map));
});
