import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../core/utils/currency.dart';

/// Label Indonesia untuk `audit_logs.action`. Nilai tak dikenal ditampilkan
/// apa adanya supaya aksi baru tetap terbaca sebelum dipetakan di sini.
const auditActionLabels = <String, String>{
  'pos.checkout': 'Checkout Transaksi',
  'pos.payment': 'Pembayaran',
  'order.create': 'Buat Order Service',
  'job.assign': 'Tugaskan Teknisi',
  'job.start': 'Mulai Pekerjaan',
  'job.complete': 'Selesaikan Pekerjaan',
  'job.cancel': 'Batalkan Pekerjaan',
  'job.photo': 'Unggah Foto Bukti',
  'request.submit': 'Ajukan Material',
  'request.approve': 'Setujui Pengajuan',
  'request.revise': 'Revisi Pengajuan',
  'request.reject': 'Tolak Pengajuan',
  'request.used': 'Material Dipakai',
  'stock.adjust': 'Mutasi Stok',
  'user.create': 'Buat Akun',
  'user.update': 'Ubah Akun',
  'user.reset_password': 'Reset Password',
};

String auditActionLabel(String action) =>
    auditActionLabels[action] ?? (action.isEmpty ? 'Aktivitas' : action);

/// Label Indonesia untuk kunci di dalam `detail` JSON. Kunci tak dikenal
/// diubah dari `camelCase`/`snake_case` jadi kata berspasi (lihat
/// [auditDetailLabel]) supaya tetap terbaca tanpa harus dipetakan satu per satu.
const auditDetailLabels = <String, String>{
  'invoiceId': 'Invoice',
  'invoiceNumber': 'No. Invoice',
  'transactionId': 'Transaksi',
  'memberId': 'Member',
  'technicianId': 'Teknisi',
  'jobId': 'Job',
  'requestId': 'Pengajuan',
  'orderId': 'Order',
  'unitId': 'Unit AC',
  'grandTotal': 'Total',
  'totalPaid': 'Sudah Dibayar',
  'outstanding': 'Sisa',
  'amount': 'Nominal',
  'total': 'Total',
  'method': 'Metode',
  'status': 'Status',
  'qtyChange': 'Perubahan Qty',
  'reason': 'Alasan',
  'role': 'Peran',
  'email': 'Email',
  'displayName': 'Nama',
  'note': 'Catatan',
  'decisionNote': 'Catatan Keputusan',
  'itemCount': 'Jumlah Item',
};

/// Kunci yang isinya rupiah — ditampilkan terformat, bukan angka mentah.
const _moneyKeys = {
  'grandTotal',
  'totalPaid',
  'outstanding',
  'amount',
  'total',
  'subtotal',
  'discount',
  'taxAmount',
  'transportFee',
  'lineTotal',
  'unitPrice',
};

/// `grandTotal` -> `Grand Total`, `qty_change` -> `Qty Change`.
String auditDetailLabel(String key) {
  final known = auditDetailLabels[key];
  if (known != null) return known;
  final spaced = key
      .replaceAll('_', ' ')
      .replaceAllMapped(RegExp(r'(?<=[a-z0-9])([A-Z])'), (m) => ' ${m[1]}')
      .trim();
  if (spaced.isEmpty) return key;
  return spaced
      .split(RegExp(r'\s+'))
      .map((w) => w[0].toUpperCase() + w.substring(1))
      .join(' ');
}

/// Nilai detail siap tampil: rupiah diformat, boolean jadi Ya/Tidak, timestamp
/// jadi tanggal lokal, sisanya apa adanya.
String auditDetailValue(String key, Object? value) {
  if (value == null) return '-';
  if (value is bool) return value ? 'Ya' : 'Tidak';
  if (value is num && _moneyKeys.contains(key)) {
    return formatRupiahNum(value);
  }
  if (value is String) {
    final asDate = DateTime.tryParse(value);
    // Hanya string yang memang bertanda waktu (ada 'T' / offset) yang
    // diperlakukan tanggal — `DateTime.tryParse` juga menerima '2026' saja.
    if (asDate != null && value.contains('T')) {
      return formatAuditTime(asDate.toLocal());
    }
  }
  return '$value';
}

class AuditEntry {
  const AuditEntry({
    required this.id,
    required this.action,
    required this.actorName,
    required this.target,
    required this.detail,
    this.at,
  });

  final String id;
  final String action;

  /// Nama pelaku (embed `users`); kosong bila baris ditulis tanpa aktor.
  final String actorName;
  final String target;
  final Map<String, dynamic> detail;
  final DateTime? at;

  String get label => auditActionLabel(action);

  /// Grup aksi ('pos', 'job', …) — dasar filter & pewarnaan.
  String get group => action.split('.').first;

  factory AuditEntry.fromMap(Map<String, dynamic> row) {
    final actor = row['actor'] as Map<String, dynamic>?;
    final name = (actor?['display_name'] as String?) ?? '';
    return AuditEntry(
      id: '${row['id']}',
      action: (row['action'] as String?) ?? '',
      actorName: name.isNotEmpty ? name : (actor?['email'] as String?) ?? '',
      target: (row['target'] as String?) ?? '',
      detail: (row['detail'] as Map?)?.cast<String, dynamic>() ?? const {},
      at: DateTime.tryParse('${row['at']}')?.toLocal(),
    );
  }
}

/// Rentang waktu yang bisa dipilih di layar riwayat aktivitas.
enum AuditRange {
  today('Hari ini', 1),
  week('7 hari', 7),
  month('30 hari', 30),
  all('Semua', 0);

  const AuditRange(this.label, this.days);

  final String label;

  /// 0 = tanpa batas waktu.
  final int days;

  /// Batas bawah query, atau null bila tanpa batas. [today] dihitung dari
  /// tengah malam waktu lokal, bukan "24 jam terakhir" — itu yang dimaksud
  /// orang saat memilih "hari ini".
  DateTime? since(DateTime now) => switch (this) {
        AuditRange.all => null,
        AuditRange.today => DateTime(now.year, now.month, now.day),
        _ => now.subtract(Duration(days: days)),
      };
}

/// Kriteria yang sedang dipakai layar riwayat aktivitas.
///
/// Disimpan sebagai satu objek (bukan beberapa provider terpisah) supaya
/// perubahan apa pun cukup memicu satu kali fetch ulang.
class AuditFilter {
  const AuditFilter({
    this.group,
    this.range = AuditRange.week,
    this.search = '',
    this.limit = _pageSize,
  });

  static const _pageSize = 50;

  /// null = semua grup aksi.
  final String? group;
  final AuditRange range;

  /// Dicocokkan ke `action` & `target` di sisi server.
  final String search;

  /// Berapa baris diminta. Bertambah [_pageSize] tiap "Muat lebih banyak".
  final int limit;

  AuditFilter copyWith({
    String? group,
    bool clearGroup = false,
    AuditRange? range,
    String? search,
    int? limit,
  }) =>
      AuditFilter(
        group: clearGroup ? null : (group ?? this.group),
        range: range ?? this.range,
        search: search ?? this.search,
        limit: limit ?? this.limit,
      );

  /// Ganti kriteria selalu mengembalikan paginasi ke halaman pertama —
  /// mempertahankan limit lama membuat filter baru langsung menarik ratusan
  /// baris tanpa diminta.
  AuditFilter reset({
    String? group,
    bool clearGroup = false,
    AuditRange? range,
    String? search,
  }) =>
      copyWith(
        group: group,
        clearGroup: clearGroup,
        range: range,
        search: search,
        limit: _pageSize,
      );

  AuditFilter get nextPage => copyWith(limit: limit + _pageSize);
}

final auditFilterProvider =
    StateProvider.autoDispose<AuditFilter>((ref) => const AuditFilter());

/// Hasil satu kali muat: entri + apakah masih ada halaman berikutnya.
typedef AuditPage = ({List<AuditEntry> entries, bool hasMore});

/// Riwayat audit (admin). `audit_logs` dibuka BACA untuk admin di migrasi 0018
/// — sebelumnya tabel ini tertutup total untuk client.
///
/// Penyaringan dilakukan di SERVER (rentang waktu, grup aksi, pencarian) supaya
/// tabel yang terus bertambah tidak ditarik utuh ke perangkat hanya untuk
/// dibuang di sisi klien.
final auditLogsProvider =
    FutureProvider.autoDispose<AuditPage>((ref) async {
  final filter = ref.watch(auditFilterProvider);

  var query = ref
      .watch(supabaseProvider)
      .from('audit_logs')
      .select('id,action,target,detail,at,actor:users(display_name,email)');

  final since = filter.range.since(DateTime.now());
  if (since != null) {
    query = query.gte('at', since.toUtc().toIso8601String());
  }
  if (filter.group != null) {
    query = query.like('action', '${filter.group}.%');
  }
  final search = filter.search.trim();
  if (search.isNotEmpty) {
    // Koma & tanda kurung memisahkan cabang di sintaks `or` PostgREST, jadi
    // harus dibuang dari input pengguna sebelum ditempel ke pola.
    final safe = search.replaceAll(RegExp(r'[,()*]'), '');
    if (safe.isNotEmpty) {
      query = query.or('action.ilike.%$safe%,target.ilike.%$safe%');
    }
  }

  // Minta satu baris lebih banyak dari yang ditampilkan: kalau kelebihannya
  // ada, berarti masih ada halaman berikutnya — tanpa perlu query COUNT kedua.
  final rows = await query
      .order('at', ascending: false)
      .limit(filter.limit + 1);

  final list = (rows as List);
  final hasMore = list.length > filter.limit;
  return (
    entries: [
      for (final r in list.take(filter.limit))
        AuditEntry.fromMap((r as Map).cast<String, dynamic>()),
    ],
    hasMore: hasMore,
  );
});

String formatAuditTime(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
}
