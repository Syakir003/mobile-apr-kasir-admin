import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../master/master_providers.dart' show firestoreProvider;
import 'cart_state.dart';

/// State keranjang aktif untuk satu sesi transaksi POS.
///
/// Semua mutasi harga/stok yang sesungguhnya terjadi lewat Cloud Function
/// `checkoutTransaction` (ADR-2) — notifier ini hanya mengelola state UI
/// client-side (pratinjau) sebelum payload dikirim.
class CartNotifier extends Notifier<Cart> {
  @override
  Cart build() => const Cart();

  /// Menambah [line] ke keranjang. Baris dengan kind+refId sama digabung
  /// qty-nya (lihat [mergeCartLine]) — ini JUGA mencocokkan validasi server
  /// yang menolak item duplikat kind+refId.
  void addLine(CartLine line) {
    state = state.copyWith(lines: mergeCartLine(state.lines, line));
  }

  /// Mengatur qty baris ke-[index]. Qty <= 0 diabaikan (gunakan [removeAt]
  /// untuk menghapus baris).
  void setQty(int index, num qty) {
    if (qty <= 0) return;
    final lines = [...state.lines];
    lines[index] = lines[index].copyWith(qty: qty);
    state = state.copyWith(lines: lines);
  }

  void removeAt(int index) {
    final lines = [...state.lines]..removeAt(index);
    state = state.copyWith(lines: lines);
  }

  /// Mengatur toggle pemasangan pada baris product ke-[index].
  ///
  /// [technicianId] hanya diterapkan bila diisi atau [clearTechnician]
  /// bernilai true (dropdown "Belum ditentukan" -> technicianId null).
  void setInstallation(
    int index, {
    bool? enabled,
    String? roomLocation,
    String? technicianId,
    bool clearTechnician = false,
  }) {
    final lines = [...state.lines];
    lines[index] = lines[index].copyWith(
      withInstallation: enabled,
      roomLocation: roomLocation,
      technicianId: technicianId,
      clearTechnicianId: clearTechnician,
    );
    state = state.copyWith(lines: lines);
  }

  void setDiscount(int value) => state = state.copyWith(discount: value);

  void setTaxPercent(double value) =>
      state = state.copyWith(taxPercent: value);

  void setTransportFee(int value) =>
      state = state.copyWith(transportFee: value);

  void setCustomer({String? name, String? phone, String? address}) {
    state = state.copyWith(
      customerName: name,
      customerPhone: phone,
      customerAddress: address,
    );
  }

  void setNotes(String value) => state = state.copyWith(notes: value);

  /// Mengosongkan keranjang. Dipanggil setelah checkout sukses.
  void clear() => state = const Cart();
}

final cartProvider = NotifierProvider<CartNotifier, Cart>(CartNotifier.new);

/// Teknisi aktif untuk dropdown pemasangan: koleksi `users` dengan
/// `role == 'teknisi'` dan `active == true`, dipetakan dari doc id +
/// field `display_name`.
final techniciansProvider =
    StreamProvider<List<({String uid, String name})>>((ref) {
  final db = ref.watch(firestoreProvider);
  return db
      .collection('users')
      .where('role', isEqualTo: 'teknisi')
      .where('active', isEqualTo: true)
      .snapshots()
      .map(
        (snap) => snap.docs
            .map(
              (d) => (
                uid: d.id,
                name: (d.data()['display_name'] as String?) ?? '',
              ),
            )
            .toList(),
      );
});

/// Memanggil Cloud Function `checkoutTransaction`. Dipisah sebagai provider
/// agar mudah di-override fake pada widget test (pola
/// `acUnitBarcodeGeneratorProvider` di `member_providers.dart`).
final checkoutCallerProvider = Provider<
    Future<({String invoiceId, String invoiceNumber})> Function(
        Map<String, dynamic>)>((ref) {
  return (payload) async {
    final callable =
        FirebaseFunctions.instance.httpsCallable('checkoutTransaction');
    final result = await callable.call<dynamic>(payload);
    final data = result.data as Map;
    return (
      invoiceId: (data['invoiceId'] as String?) ?? '',
      invoiceNumber: (data['invoiceNumber'] as String?) ?? '',
    );
  };
});
