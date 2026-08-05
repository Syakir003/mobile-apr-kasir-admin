import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';

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

/// Riwayat audit terbaru (admin). `audit_logs` baru dibuka BACA untuk admin di
/// migrasi 0018 — sebelumnya tabel ini tertutup total untuk client.
final auditLogsProvider =
    FutureProvider.autoDispose<List<AuditEntry>>((ref) async {
  final rows = await ref
      .watch(supabaseProvider)
      .from('audit_logs')
      .select('id,action,target,detail,at,actor:users(display_name,email)')
      .order('at', ascending: false)
      .limit(200);

  return [
    for (final r in (rows as List))
      AuditEntry.fromMap((r as Map).cast<String, dynamic>()),
  ];
});
