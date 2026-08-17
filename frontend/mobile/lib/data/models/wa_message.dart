// Kolom timestamptz Postgres tiba sebagai string ISO-8601 lewat PostgREST.
DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

/// Jenis pesan pengingat (kolom `kind` di `wa_outbox`).
enum WaKind {
  selesaiServis('selesai_servis', 'Selesai Servis'),
  reminderH3('reminder_h3', 'Pengingat H-3'),
  reminderH7('reminder_h7', 'Terlambat 7 Hari'),
  menangUndian('menang_undian', 'Menang Undian'),
  voucherBaru('voucher_baru', 'Voucher Baru');

  const WaKind(this.value, this.label);

  final String value;
  final String label;

  static WaKind fromValue(Object? value) => values.firstWhere(
        (k) => k.value == value,
        orElse: () => WaKind.selesaiServis,
      );
}

/// Status satu baris antrean (kolom `status`).
enum WaStatus {
  pending('pending', 'Menunggu Dikirim'),
  terkirim('terkirim', 'Terkirim'),
  gagal('gagal', 'Gagal'),
  dibatalkan('dibatalkan', 'Dibatalkan');

  const WaStatus(this.value, this.label);

  final String value;
  final String label;

  static WaStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => WaStatus.pending,
      );
}

/// Satu pesan WhatsApp di antrean (tabel `wa_outbox`).
///
/// [phone] sudah dinormalisasi ke format `62xxxxxxxxxx` oleh `wa_phone()` di
/// Postgres, dan [body] sudah tersusun lengkap oleh `build_wa_body()` — klien
/// tidak menyusun ulang teks pesan, supaya redaksi yang dikirim admin identik
/// dengan yang nanti diajukan sebagai template Meta.
class WaMessage {
  const WaMessage({
    required this.id,
    required this.memberId,
    required this.memberName,
    required this.phone,
    required this.kind,
    required this.body,
    required this.status,
    this.unitCount = 0,
    this.dueDate,
    this.createdAt,
  });

  final String id;
  final String memberId;
  final String memberName;
  final String phone;
  final WaKind kind;
  final String body;
  final WaStatus status;
  final int unitCount;
  final DateTime? dueDate;
  final DateTime? createdAt;

  /// Tautan yang membuka WhatsApp dengan pesan sudah terisi penuh, tinggal
  /// tekan kirim. Inilah "adapter manual" di sisi klien.
  ///
  /// `Uri.encodeComponent` wajib: [body] mengandung baris baru, tanda '&', dan
  /// em-dash pada tanda tangan — tanpa encoding, pesan terpotong di tengah.
  Uri get waUri =>
      Uri.parse('https://wa.me/$phone?text=${Uri.encodeComponent(body)}');

  factory WaMessage.fromMap(String id, Map<String, dynamic> data) => WaMessage(
        id: id,
        memberId: (data['member_id'] as String?) ?? '',
        memberName: (data['member_name'] as String?) ?? '',
        phone: (data['phone'] as String?) ?? '',
        kind: WaKind.fromValue(data['kind']),
        body: (data['body'] as String?) ?? '',
        status: WaStatus.fromValue(data['status']),
        unitCount: (data['unit_ids'] as List?)?.length ?? 0,
        dueDate: _toDate(data['due_date']),
        createdAt: _toDate(data['created_at']),
      );
}
