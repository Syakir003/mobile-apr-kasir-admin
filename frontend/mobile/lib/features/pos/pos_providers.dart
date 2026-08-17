import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../data/models/member.dart';
import 'cart_state.dart';

/// State keranjang aktif untuk satu sesi transaksi POS.
///
/// Semua mutasi harga/stok yang sesungguhnya terjadi lewat RPC Postgres
/// `checkout_transaction` (ADR-2) — notifier ini hanya mengelola state UI
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
  /// untuk menghapus baris). Unit AC terpilih yang melebihi qty baru dipangkas
  /// agar jumlah unit tidak pernah melampaui qty (ditolak server).
  void setQty(int index, num qty) {
    if (qty <= 0) return;
    final lines = [...state.lines];
    final line = lines[index];
    final maxUnits = qty.round();
    lines[index] = line.copyWith(
      qty: qty,
      unitIds: line.unitIds.length > maxUnits
          ? line.unitIds.sublist(0, maxUnits)
          : null,
    );
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

  /// Memilih member terdaftar sebagai pelanggan transaksi: data pelanggan
  /// diisi dari master member agar nomor HP persis sama dengan yang tersimpan
  /// (server mencocokkan member lewat nomor HP — salah ketik satu digit
  /// membuat member kembar). Unit AC yang sudah terpilih di baris jasa
  /// direset karena unit milik member lama tidak berlaku lagi.
  void selectMember(Member member) {
    state = state.copyWith(
      memberId: member.id,
      customerName: member.name,
      customerPhone: member.phone,
      customerAddress: member.address,
      lines: _linesWithoutUnits(),
    );
  }

  /// Melepas pilihan member dan mengosongkan data pelanggan (pelanggan baru
  /// yang akan dibuatkan member otomatis oleh server saat checkout).
  void clearMember() {
    state = state.copyWith(
      clearMember: true,
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      lines: _linesWithoutUnits(),
    );
  }

  List<CartLine> _linesWithoutUnits() => [
        for (final line in state.lines)
          line.unitIds.isEmpty ? line : line.copyWith(unitIds: const []),
      ];

  /// Menandai/melepas unit AC pada baris jasa ke-[index]. Penambahan diabaikan
  /// bila jumlah unit sudah mencapai qty baris (satu unit = satu job).
  void toggleServiceUnit(int index, String unitId) {
    final line = state.lines[index];
    if (line.kind != CartItemKind.service) return;
    final selected = [...line.unitIds];
    if (selected.remove(unitId)) {
      _replaceLine(index, line.copyWith(unitIds: selected));
      return;
    }
    if (selected.length >= line.qty.round()) return;
    _replaceLine(index, line.copyWith(unitIds: [...selected, unitId]));
  }

  /// Teknisi untuk seluruh unit pada baris jasa ke-[index]. Null =
  /// "Belum ditentukan" (job lahir berstatus menunggu penugasan).
  void setServiceTechnician(int index, String? technicianId) {
    _replaceLine(
      index,
      state.lines[index].copyWith(
        technicianId: technicianId,
        clearTechnicianId: technicianId == null,
      ),
    );
  }

  void _replaceLine(int index, CartLine line) {
    final lines = [...state.lines];
    lines[index] = line;
    state = state.copyWith(lines: lines);
  }

  void setNotes(String value) => state = state.copyWith(notes: value);

  void setVoucherCode(String value) =>
      state = state.copyWith(voucherCode: value);

  /// Mengosongkan keranjang. Dipanggil setelah checkout sukses.
  void clear() => state = const Cart();
}

final cartProvider = NotifierProvider<CartNotifier, Cart>(CartNotifier.new);

/// Teknisi aktif untuk dropdown pemasangan: tabel `users` dengan
/// `role == 'teknisi'` dan `active == true`, dipetakan dari id +
/// kolom `display_name`. (Stream Realtime hanya mendukung satu filter,
/// jadi `active` disaring di client.)
final techniciansProvider =
    StreamProvider<List<({String uid, String name})>>((ref) {
  final client = ref.watch(supabaseProvider);
  return client
      .from('users')
      .stream(primaryKey: ['id'])
      .eq('role', 'teknisi')
      .map(
        (rows) => rows
            .where((row) => (row['active'] as bool?) ?? false)
            .map(
              (row) => (
                uid: row['id'] as String,
                name: (row['display_name'] as String?) ?? '',
              ),
            )
            .toList(),
      );
});

/// Memanggil RPC `checkout_transaction`. Dipisah sebagai provider
/// agar mudah di-override fake pada widget test (pola
/// `acUnitBarcodeGeneratorProvider` di `member_providers.dart`).
final checkoutCallerProvider = Provider<
    Future<({String invoiceId, String invoiceNumber})> Function(
        Map<String, dynamic>)>((ref) {
  return (payload) async {
    final result = await ref
        .read(supabaseProvider)
        .rpc('checkout_transaction', params: {'payload': payload});
    final data = result as Map;
    return (
      invoiceId: (data['invoiceId'] as String?) ?? '',
      invoiceNumber: (data['invoiceNumber'] as String?) ?? '',
    );
  };
});
