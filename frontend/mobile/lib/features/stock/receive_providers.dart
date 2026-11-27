import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';

/// Barang yang bisa diterima gudang. [outdoorId] terisi = Indoor dari paket AC.
class ReceiveItem {
  const ReceiveItem({
    required this.id,
    required this.kind,
    required this.name,
    required this.unit,
    this.outdoorId,
    this.batchTracked = false,
  });

  final String id;
  final String kind; // product | sparepart
  final String name;
  final String unit;
  final String? outdoorId;
  final bool batchTracked; // sparepart per gulungan
}

/// Outdoor milik paket tidak ditawarkan: ia diterima lewat Indoor-nya.
List<ReceiveItem> receiveItemsFrom({required List products, required List spareparts}) {
  final outdoorIds = {for (final p in products) (p as Map)['pairedProductId']};
  return [
    for (final p in products.cast<Map>())
      if (!outdoorIds.contains(p['id']))
        ReceiveItem(
          id: '${p['id']}',
          kind: 'product',
          name: '${p['name']}',
          unit: 'unit',
          outdoorId: p['pairedProductId'] as String?,
        ),
    for (final s in spareparts.cast<Map>())
      ReceiveItem(
        id: '${s['id']}',
        kind: 'sparepart',
        name: '${s['name']}',
        unit: '${s['unit'] ?? ''}',
        batchTracked: s['batchTracked'] == true,
      ),
  ];
}

final receiveItemsProvider = FutureProvider.autoDispose<List<ReceiveItem>>((ref) async {
  const api = ApiClient();
  return receiveItemsFrom(
    products: await api.get('/products') as List,
    spareparts: await api.get('/spareparts') as List,
  );
});

/// Muatan `POST /stock/in` TANPA harga modal: admin mengisinya belakangan.
Map<String, dynamic> buildReceivePayload(
  ReceiveItem item, {
  num qty = 0,
  num outdoorQty = 0,
  List<num> rolls = const [],
  String supplier = '',
}) =>
    {
      'kind': item.kind,
      'refId': item.id,
      if (item.batchTracked)
        'rolls': [for (final l in rolls) {'length': l}]
      else
        'qty': qty,
      if (item.outdoorId != null) ...{
        'outdoorQty': outdoorQty,
        'pairMode': 'lengkap',
        'outdoorRefId': item.outdoorId,
      },
      if (supplier.trim().isNotEmpty) 'supplierName': supplier.trim(),
    };

/// `POST /stock/in`; balikan apa adanya (memuat batchId untuk cetak label).
final receiveCallerProvider =
    Provider<Future<Map<String, dynamic>> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async =>
      Map<String, dynamic>.from(await const ApiClient().post('/stock/in', body: payload) as Map);
});
